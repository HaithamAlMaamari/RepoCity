/**
 * Squarified treemap layout algorithm (Bruls, Huizingen, van Wijk, 2000).
 *
 * Lays out a tree of file/directory nodes as rectangles where area
 * is proportional to file size and aspect ratios stay close to 1:1.
 */

import { classifyBuilding, detectLanguage } from './file-class';

/** Options controlling the treemap layout. */
export interface LayoutOptions {
  /** Canvas width in pixels (default: 200). */
  width?: number;
  /** Canvas height in pixels (default: 200). */
  height?: number;
  /** Base padding between rectangles in pixels (default: 0.5). */
  padding?: number;
  /** Additional padding per depth level (default: 0.3). */
  depthScale?: number;
}

/** A positioned rectangle with depth info. */
export interface LayoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
}

/** A single cell in the final layout: a tree node plus its rectangle. */
export interface LayoutCell {
  node: TreeNode;
  rect: LayoutRect;
}

/** A node in the repository file tree. */
export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
  children: TreeNode[];
  language?: string;
}

/** Internal mutable rectangle used during layout. */
interface WorkRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Normalised options with all defaults applied. */
interface NormalizedOptions {
  width: number;
  height: number;
  padding: number;
  depthScale: number;
}

const DEFAULT_OPTIONS: NormalizedOptions = {
  width: 200,
  height: 200,
  padding: 0.25,
  depthScale: 0.3,
};

/**
 * How much ground a repository of this many files gets, in world units.
 *
 * The `sqrt` is the load-bearing part: land area grows in proportion to the
 * file count, so the plot a file receives — and therefore how wide its
 * building is against a height range that does not change — stays constant
 * however large the repository is.
 *
 * The cap is a deliberate departure from that, and it is a COMPOSITION
 * decision rather than an oversight.
 *
 * Both alternatives were built and rendered against real repositories. Letting
 * land grow freely does give perfectly constant building proportions — median
 * height-to-width holds at about 1.7:1 from 13 files to 5,000 — and it looks
 * markedly worse: a 5,000-file city covers four times the ground with no extra
 * height, so the camera pulls back to fit it and the skyline reads as a
 * distant pancake of cubes. Raising the cap to 560 as a halfway position was
 * no better. DENSITY is what makes the picture read as a city, and density is
 * what the cap preserves.
 *
 * The proportion problem the cap causes is real, and it is addressed where it
 * belongs instead: plot area is now depth-independent and the gutter decays
 * with depth, which widens the median plot substantially at a fixed land size.
 * What is left is a framing question — a large city should be viewed from
 * within rather than fitted entirely on screen — and that is camera work.
 */
export function repositoryLandSize(renderedFileCount: number): number {
  const count = Math.max(1, Math.floor(renderedFileCount));
  return Math.min(240, Math.max(32, Math.round((16 + 14 * Math.sqrt(count)) * 2) / 2));
}

/**
 * Build a squarified treemap layout for the given file tree.
 *
 * Each file node is assigned a rectangle whose area is proportional to its
 * size.  Directory nodes are recursively laid out inside their bounding
 * rectangle.  Zero-size files are treated as having a minimum size of 1 so
 * they remain visible.
 *
 * @param root   The root directory node of the repository tree.
 * @param options Optional layout configuration.
 * @returns An array of layout cells, one per visible file rectangle.
 */
export function buildLayout(
  root: TreeNode,
  options?: LayoutOptions,
): LayoutCell[] {
  const opts = applyDefaults(options);
  const cells: LayoutCell[] = [];

  // Once for the whole tree: recursing per level would be O(n * depth).
  const weights = computeWeights(root);

  // Treat the root as the container; layout its children.
  const rect: WorkRect = { x: 0, y: 0, w: opts.width, h: opts.height };
  const items = root.children.map((node) => weigh(node, weights)).sort(byWeightDescending);

  squarify(items, rect, 0, cells, opts, weights);
  return cells;
}

/**
 * Most of an axis a cell may lose to its gutter, at the top of the tree.
 *
 * The cap is charged once per ANCESTOR, so a flat value compounds: at 0.25 a
 * cell three levels down keeps 0.75^6 = 18% of its area, and 77% of all
 * placements were hitting the cap on both axes. Deleting the gutter is not the
 * answer — the gaps are what read as streets — but charging an arterial's
 * width between two sibling files is.
 *
 * Decaying it geometrically makes the total charge convergent and gives the
 * city the street hierarchy it should have had all along: a wide gap between
 * top-level districts, a narrow one between files in the same folder.
 */
const MAX_GUTTER_FRACTION = 0.22;
const GUTTER_DEPTH_DECAY = 0.55;

/**
 * A node paired with the area weight the treemap should give it.
 *
 * The weight is kept beside the node rather than written into `node.size`,
 * because that field is the file's real byte count: the explorer displays it,
 * and `buildCity` ranks building heights by it. Compressing it in place would
 * silently corrupt both.
 */
interface WeightedItem {
  node: TreeNode;
  weight: number;
}

/**
 * How strongly parcel area is compressed relative to raw bytes.
 *
 * Area used to be exactly proportional to size, which meant a single 400 KB
 * changelog in a repository of 4 KB source files claimed a plot a hundred
 * times the median and left the rest of the city as slivers around it. At 0.55
 * that same file gets roughly a twelvefold plot instead of a hundredfold one.
 *
 * Ordering is untouched — the transform is strictly increasing, so a bigger
 * file still gets a bigger plot, and the City Index's "plot area is
 * approximately proportional to file bytes" stays true in the sense that
 * matters to a reader comparing two buildings. Exact proportionality is what
 * is traded away.
 */
const AREA_EXPONENT = 0.55;

/**
 * Non-source bulk is compressed harder than source.
 *
 * Lockfiles, minified bundles, fixtures and media are ground rather than
 * architecture — they render as low, wide depots on purpose. But their plots
 * are byte-proportional, and generated files are enormous, so in react the
 * `fixtures/` lockfile district alone claimed roughly a third of the map: a
 * flat plateau taking up more of the city than all of `packages/`. Compressing
 * their area more aggressively keeps the metaphor (a big lockfile is still a
 * big depot) while stopping it dominating the picture.
 */
const INFRA_AREA_EXPONENT = 0.4;

/**
 * Ceiling on the share of the map non-source files may occupy in total.
 *
 * The exponent alone is not enough for a repository that is mostly generated
 * bulk. This is a backstop on the aggregate, applied before directory weights
 * are summed so the whole tree stays consistent with it.
 */
const MAX_INFRA_SHARE = 0.15;

/**
 * Area weight for every node in the tree, computed once.
 *
 * A LEAF is compressed by its category's exponent. A DIRECTORY is the SUM of
 * its children's weights — NOT `(its own bytes)^AREA_EXPONENT`.
 *
 * That distinction is the whole point. Because `x^0.55` is sub-additive,
 * `(Σs)^0.55 < Σ(s^0.55)`, so charging the exponent again at every directory
 * level meant a folder always received less area than its contents claimed,
 * compounding once per level of nesting. Measured on a realistic tree: two
 * IDENTICAL 3 KB files six levels apart differed in plot area by 2,484x, while
 * the entire byte range of the repository only spans about 175x. Tree depth
 * outweighed file size by an order of magnitude — the precise opposite of what
 * the City Index promises a reader.
 *
 * Applying the compression once, at the leaves, makes a file's share of the
 * land exactly its share of the total leaf weight, wherever it sits.
 */
function computeWeights(root: TreeNode): Map<TreeNode, number> {
  const weights = new Map<TreeNode, number>();
  const infrastructure: TreeNode[] = [];
  let sourceTotal = 0;
  let infraTotal = 0;

  const weighLeaves = (node: TreeNode): void => {
    if (node.type !== 'file') {
      for (const child of node.children) weighLeaves(child);
      return;
    }
    const language = node.language ?? detectLanguage(node.name);
    const infra = classifyBuilding(node.path, language, node.size) === 'infrastructure';
    const weight = Math.pow(Math.max(node.size, 1), infra ? INFRA_AREA_EXPONENT : AREA_EXPONENT);
    weights.set(node, weight);
    if (infra) {
      infrastructure.push(node);
      infraTotal += weight;
    } else {
      sourceTotal += weight;
    }
  };
  weighLeaves(root);

  // Solve for the scale that lands infrastructure exactly on its ceiling:
  // target / (source + target) = MAX  =>  target = MAX * source / (1 - MAX).
  if (infraTotal > 0 && infraTotal / (sourceTotal + infraTotal) > MAX_INFRA_SHARE) {
    const target = (MAX_INFRA_SHARE * sourceTotal) / (1 - MAX_INFRA_SHARE);
    const scale = target / infraTotal;
    for (const leaf of infrastructure) weights.set(leaf, (weights.get(leaf) ?? 0) * scale);
  }

  const sumUp = (node: TreeNode): number => {
    if (node.type === 'file') return weights.get(node) ?? 0;
    let total = 0;
    for (const child of node.children) total += sumUp(child);
    weights.set(node, total);
    return total;
  };
  sumUp(root);
  return weights;
}

/** Pair a node with its precomputed weight. */
function weigh(node: TreeNode, weights: Map<TreeNode, number>): WeightedItem {
  return { node, weight: weights.get(node) ?? 0 };
}

/** Descending by weight — the order squarify expects. */
function byWeightDescending(a: WeightedItem, b: WeightedItem): number {
  return b.weight - a.weight;
}

/**
 * Apply user-provided options on top of the defaults.
 */
function applyDefaults(options?: LayoutOptions): NormalizedOptions {
  return {
    width: options?.width ?? DEFAULT_OPTIONS.width,
    height: options?.height ?? DEFAULT_OPTIONS.height,
    padding: options?.padding ?? DEFAULT_OPTIONS.padding,
    depthScale: options?.depthScale ?? DEFAULT_OPTIONS.depthScale,
  };
}

/**
 * Recursively squarify a list of items into the given rectangle.
 *
 * Greedily builds rows of items, preferring the grouping that yields the
 * best (lowest) worst-case aspect ratio.  After committing a row, the
 * remaining area and items are processed recursively.
 */
function squarify(
  items: WeightedItem[],
  rect: WorkRect,
  depth: number,
  cells: LayoutCell[],
  options: NormalizedOptions,
  weights: Map<TreeNode, number>,
): void {
  if (items.length === 0) return;

  const totalSize = sumWeights(items);
  if (totalSize === 0) return;

  // Build a row greedily
  const row: WeightedItem[] = [items[0]];
  let rowArea = items[0].weight;

  for (let i = 1; i < items.length; i++) {
    const candidate = [...row, items[i]];
    const candidateArea = rowArea + items[i].weight;
    if (
      worstAspect(candidate, totalSize, rect) <=
      worstAspect(row, totalSize, rect)
    ) {
      row.push(items[i]);
      rowArea = candidateArea;
    } else {
      break;
    }
  }

  const remaining = items.slice(row.length);

  // Determine row orientation and dimensions
  const isHorizontal = rect.w <= rect.h;
  const thickness = (rowArea / totalSize) * (isHorizontal ? rect.h : rect.w);
  const otherSide = isHorizontal ? rect.w : rect.h;

  // Layout each item in the row
  let offset = 0;

  for (const item of row) {
    const itemShare = item.weight / rowArea;
    const itemLength = itemShare * otherSide;

    let itemRect: LayoutRect;
    if (isHorizontal) {
      itemRect = {
        x: rect.x + offset,
        y: rect.y,
        w: itemLength,
        h: thickness,
        depth,
      };
    } else {
      itemRect = {
        x: rect.x,
        y: rect.y + offset,
        w: thickness,
        h: itemLength,
        depth,
      };
    }

    /*
     * Gutter between this cell and its neighbours.
     *
     * The requested amount still grows with depth, so nested directories read
     * as separate blocks. What is new is the ceiling: it is capped per axis at
     * a fraction of that axis, and applied to width and height independently.
     *
     * Before, the gutter was a flat world-unit subtraction applied to both
     * axes and compounded down the whole ancestor chain, so a file four levels
     * deep lost 4.75 units from each side before its own parcel was measured.
     * Two files of identical size ended up with wildly different plots purely
     * because one sat deeper in the tree, thin cells were reduced to slivers,
     * and any cell narrower than the gutter was silently dropped from the city
     * altogether by the `> 0` guard below.
     */
    const requested = options.padding + options.depthScale * depth;
    const fraction = MAX_GUTTER_FRACTION * Math.pow(GUTTER_DEPTH_DECAY, depth);
    const padX = Math.min(requested, itemRect.w * fraction);
    const padY = Math.min(requested, itemRect.h * fraction);
    const paddedRect: LayoutRect = {
      x: itemRect.x + padX / 2,
      y: itemRect.y + padY / 2,
      w: Math.max(0, itemRect.w - padX),
      h: Math.max(0, itemRect.h - padY),
      depth,
    };

    if (item.node.type === 'file') {
      if (paddedRect.w > 0 && paddedRect.h > 0) {
        cells.push({ node: item.node, rect: paddedRect });
      }
    } else {
      // Recurse into directory
      const childItems = item.node.children
        .map((node) => weigh(node, weights))
        .sort(byWeightDescending);
      squarify(childItems, paddedRect, depth + 1, cells, options, weights);
    }

    offset += itemLength;
  }

  // Shrink rectangle and recurse on remaining items
  if (remaining.length > 0) {
    let newRect: WorkRect;
    if (isHorizontal) {
      newRect = {
        x: rect.x,
        y: rect.y + thickness,
        w: rect.w,
        h: rect.h - thickness,
      };
    } else {
      newRect = {
        x: rect.x + thickness,
        y: rect.y,
        w: rect.w - thickness,
        h: rect.h,
      };
    }
    squarify(remaining, newRect, depth, cells, options, weights);
  }
}

/**
 * Compute the worst aspect ratio for a candidate row.
 *
 * Lower values mean the rectangles in the row are closer to squares.
 *
 * @param row       The items in the candidate row.
 * @param totalArea The total size of all items being laid out.
 * @param rect      The remaining rectangle to fill.
 * @returns The worst (largest) aspect ratio among the items in the row.
 */
function worstAspect(
  row: WeightedItem[],
  totalArea: number,
  rect: WorkRect,
): number {
  const rowArea = sumWeights(row);
  const isHorizontal = rect.w <= rect.h;
  const otherSide = isHorizontal ? rect.w : rect.h;
  const thickness = (rowArea / totalArea) * (isHorizontal ? rect.h : rect.w);

  if (rowArea === 0 || thickness === 0) return Infinity;

  let worst = 0;
  for (const item of row) {
    const itemLength = (item.weight / rowArea) * otherSide;
    if (itemLength === 0) continue;
    const aspect = Math.max(
      (thickness * thickness) / (itemLength * itemLength),
      (itemLength * itemLength) / (thickness * thickness),
    );
    if (aspect > worst) worst = aspect;
  }

  return worst;
}

/** Sum the layout weights of a row. */
function sumWeights(items: WeightedItem[]): number {
  let total = 0;
  for (const item of items) {
    total += item.weight;
  }
  return total;
}
