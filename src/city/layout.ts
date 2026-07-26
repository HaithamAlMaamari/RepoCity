/**
 * Squarified treemap layout algorithm (Bruls, Huizingen, van Wijk, 2000).
 *
 * Lays out a tree of file/directory nodes as rectangles where area
 * is proportional to file size and aspect ratios stay close to 1:1.
 */

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

  // Treat the root as the container; layout its children.
  const rect: WorkRect = { x: 0, y: 0, w: opts.width, h: opts.height };
  const items = root.children
    .map(normalizeSize)
    .sort((a, b) => b.size - a.size);

  squarify(items, rect, 0, cells, opts);
  return cells;
}

/**
 * Return a new node with size clamped to a minimum of 1 so that
 * zero-size files still occupy a tiny visible area.
 */
function normalizeSize(node: TreeNode): TreeNode {
  if (node.size <= 0) {
    return { ...node, size: 1 };
  }
  return node;
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
  items: TreeNode[],
  rect: WorkRect,
  depth: number,
  cells: LayoutCell[],
  options: NormalizedOptions,
): void {
  if (items.length === 0) return;

  const s = Math.min(rect.w, rect.h);
  const totalSize = sumSizes(items);
  if (totalSize === 0) return;

  // Build a row greedily
  const row: TreeNode[] = [items[0]];
  let rowArea = items[0].size;

  for (let i = 1; i < items.length; i++) {
    const candidate = [...row, items[i]];
    const candidateArea = rowArea + items[i].size;
    if (
      worstAspect(candidate, s, totalSize, rect) <=
      worstAspect(row, s, totalSize, rect)
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
    const itemShare = item.size / rowArea;
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

    // Apply padding that increases with depth
    const pad = options.padding + options.depthScale * depth;
    const paddedRect: LayoutRect = {
      x: itemRect.x + pad / 2,
      y: itemRect.y + pad / 2,
      w: Math.max(0, itemRect.w - pad),
      h: Math.max(0, itemRect.h - pad),
      depth,
    };

    if (item.type === 'file') {
      if (paddedRect.w > 0 && paddedRect.h > 0) {
        cells.push({ node: item, rect: paddedRect });
      }
    } else {
      // Recurse into directory
      const childItems = item.children
        .map(normalizeSize)
        .sort((a, b) => b.size - a.size);
      squarify(childItems, paddedRect, depth + 1, cells, options);
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
    squarify(remaining, newRect, depth, cells, options);
  }
}

/**
 * Compute the worst aspect ratio for a candidate row.
 *
 * Lower values mean the rectangles in the row are closer to squares.
 *
 * @param row       The items in the candidate row.
 * @param s         The shorter side of the remaining rectangle.
 * @param totalArea The total size of all items being laid out.
 * @param rect      The remaining rectangle to fill.
 * @returns The worst (largest) aspect ratio among the items in the row.
 */
function worstAspect(
  row: TreeNode[],
  s: number,
  totalArea: number,
  rect: WorkRect,
): number {
  const rowArea = sumSizes(row);
  const isHorizontal = rect.w <= rect.h;
  const otherSide = isHorizontal ? rect.w : rect.h;
  const thickness = (rowArea / totalArea) * (isHorizontal ? rect.h : rect.w);

  if (rowArea === 0 || thickness === 0) return Infinity;

  let worst = 0;
  for (const item of row) {
    const itemLength = (item.size / rowArea) * otherSide;
    if (itemLength === 0) continue;
    const aspect = Math.max(
      (thickness * thickness) / (itemLength * itemLength),
      (itemLength * itemLength) / (thickness * thickness),
    );
    if (aspect > worst) worst = aspect;
  }

  return worst;
}

/**
 * Sum the sizes of an array of tree nodes.
 */
function sumSizes(items: TreeNode[]): number {
  let total = 0;
  for (const item of items) {
    total += item.size;
  }
  return total;
}
