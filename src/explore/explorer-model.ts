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
