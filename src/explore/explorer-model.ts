import type { Building } from '../city/city';
import type { FetchResult, TreeNode } from '../data/github';

export interface ExplorerNode {
  path: string;
  name: string;
  type: 'directory' | 'file';
  size: number;
  language?: string;
  buildingId?: number;
  children: ExplorerNode[];
}

export interface ExplorerModel {
  roots: ExplorerNode[];
  buildingIdByPath: Map<string, number>;
  coverageText: string;
}

export type ExplorerSort = 'layout' | 'name' | 'size-asc' | 'size-desc';
export type ExplorerSize = 'all' | 'tiny' | 'small' | 'medium' | 'large';

export interface ExplorerFilterState {
  query: string;
  language: string;
  size: ExplorerSize;
  sort: ExplorerSort;
}

export interface ExplorerView {
  roots: ExplorerNode[];
  matchMask: Uint8Array;
  matchingFiles: number;
}

export function buildExplorerModel(result: FetchResult, buildings: readonly Building[]): ExplorerModel {
  const buildingIdByPath = new Map(buildings.map((building, index) => [building.path, index]));

  function include(node: TreeNode): ExplorerNode | null {
    if (node.type === 'file') {
      const buildingId = buildingIdByPath.get(node.path);
      return buildingId === undefined ? null : {
        path: node.path,
        name: node.name,
        type: 'file',
        size: node.size,
        language: node.language,
        buildingId,
        children: [],
      };
    }
    const children = node.children.map(include).filter((child): child is ExplorerNode => child !== null);
    if (children.length === 0) return null;
    return {
      path: node.path,
      name: node.name,
      type: 'directory',
      size: children.reduce((total, child) => total + child.size, 0),
      children,
    };
  }

  const roots = result.root.children.map(include).filter((node): node is ExplorerNode => node !== null);
  const rendered = buildings.length.toLocaleString('en-US');
  const selected = result.selection.returnedFiles.toLocaleString('en-US');
  const total = result.totals.files.toLocaleString('en-US');
  const renderedLabel = `${rendered} rendered file${buildings.length === 1 ? '' : 's'}`;
  const coverageText = result.coverage.selection === 'sampled'
    ? `${renderedLabel} from a deterministic sample of ${selected} selected from ${total} repository files.`
    : buildings.length === result.selection.returnedFiles
      ? `${renderedLabel} from the complete repository tree.`
      : `${renderedLabel} of ${selected} selected files from the complete repository tree.`;

  return { roots, buildingIdByPath, coverageText };
}

export function visibleExplorerNodes(roots: readonly ExplorerNode[], expanded: ReadonlySet<string>): ExplorerNode[] {
  const visible: ExplorerNode[] = [];
  const visit = (nodes: readonly ExplorerNode[]) => {
    for (const node of nodes) {
      visible.push(node);
      if (node.type === 'directory' && expanded.has(node.path)) visit(node.children);
    }
  };
  visit(roots);
  return visible;
}

export function deriveExplorerView(model: ExplorerModel, state: ExplorerFilterState): ExplorerView {
  const query = state.query.trim().toLowerCase();
  const matchMask = new Uint8Array(model.buildingIdByPath.size);
  let matchingFiles = 0;

  const matchesSize = (size: number) => state.size === 'all'
    || (state.size === 'tiny' && size < 10_000)
    || (state.size === 'small' && size >= 10_000 && size < 100_000)
    || (state.size === 'medium' && size >= 100_000 && size < 1_000_000)
    || (state.size === 'large' && size >= 1_000_000);
  const compare = (a: ExplorerNode, b: ExplorerNode): number => {
    const pathOrder = a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    if (state.sort === 'name') return a.name < b.name ? -1 : a.name > b.name ? 1 : pathOrder;
    if (state.sort === 'size-asc') return a.size - b.size || pathOrder;
    if (state.sort === 'size-desc') return b.size - a.size || pathOrder;
    return 0;
  };
  const include = (node: ExplorerNode): ExplorerNode | null => {
    if (node.type === 'file') {
      const matches = (!query || node.path.toLowerCase().includes(query))
        && (!state.language || node.language === state.language)
        && matchesSize(node.size);
      if (!matches || node.buildingId === undefined) return null;
      matchMask[node.buildingId] = 1;
      matchingFiles++;
      return { ...node, children: [] };
    }
    const children = node.children.map(include).filter((child): child is ExplorerNode => child !== null);
    if (children.length === 0) return null;
    if (state.sort !== 'layout') children.sort(compare);
    return { ...node, children };
  };
  const roots = model.roots.map(include).filter((node): node is ExplorerNode => node !== null);
  if (state.sort !== 'layout') roots.sort(compare);
  return { roots, matchMask, matchingFiles };
}
