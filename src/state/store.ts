import { useEffect, useMemo, useReducer } from 'react';
import { addEdge, applyEdgeChanges, applyNodeChanges, MarkerType } from 'reactflow';
import type { Edge, EdgeChange, Node, NodeChange, XYPosition } from 'reactflow';
import { nanoid } from 'nanoid';

export const STORAGE_KEY = 'whiteboard-notes:v1';
const NOTE_WIDTH = 220;
const NOTE_HEIGHT = 90;
const JUNCTION_SIZE = 12;

export type NoteNodeData = {
  title: string;
  body: string;
  formulaText?: string;
  connectMode?: boolean;
};

export type JunctionNodeData = {
  junctionFor: string;
  connectMode?: boolean;
};

export type WhiteboardNodeData = NoteNodeData | JunctionNodeData;

export type NoteNode = Node<WhiteboardNodeData>;
export type NoteEdge = Edge;

export type BoardSnapshot = {
  nodes: NoteNode[];
  edges: NoteEdge[];
};

type HistoryState = {
  past: BoardSnapshot[];
  present: BoardSnapshot;
  future: BoardSnapshot[];
};

type AddConnectionPayload = {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

type Action =
  | { type: 'APPLY_NODE_CHANGES'; changes: NodeChange[]; recordHistory: boolean }
  | { type: 'APPLY_EDGE_CHANGES'; changes: EdgeChange[]; recordHistory: boolean }
  | { type: 'ADD_NODE'; position: XYPosition; title?: string }
  | { type: 'UPDATE_NODE'; id: string; title: string; body: string }
  | { type: 'ADD_CONNECTION'; connection: AddConnectionPayload }
  | { type: 'DUPLICATE_NODE'; id: string }
  | { type: 'DELETE_SELECTION'; nodeIds: string[]; edgeIds: string[] }
  | { type: 'IMPORT_SNAPSHOT'; snapshot: BoardSnapshot }
  | { type: 'CLEAR' }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'COMMIT_FROM_SNAPSHOT'; snapshot: BoardSnapshot };

const emptySnapshot: BoardSnapshot = {
  nodes: [],
  edges: [],
};

function isJunctionNode(node: NoteNode): boolean {
  return node.type === 'junction' && typeof (node.data as JunctionNodeData)?.junctionFor === 'string';
}

function isNoteNode(node: NoteNode): boolean {
  return !isJunctionNode(node);
}

function createEdge(source: string, target: string): NoteEdge {
  return {
    id: `e:${source}:r-s->${target}:l-t`,
    source,
    target,
    sourceHandle: 'r-s',
    targetHandle: 'l-t',
    type: 'smoothstep',
    markerEnd: {
      type: MarkerType.ArrowClosed,
    },
    style: {
      strokeWidth: 1.5,
    },
    animated: false,
  };
}

function sanitizeNodeData(node: NoteNode): WhiteboardNodeData {
  if (isJunctionNode(node)) {
    return {
      junctionFor: (node.data as JunctionNodeData).junctionFor,
    };
  }
  return {
    title: (node.data as NoteNodeData)?.title ?? '',
    body: (node.data as NoteNodeData)?.body ?? '',
  };
}

function cloneSnapshot(snapshot: BoardSnapshot): BoardSnapshot {
  return {
    nodes: snapshot.nodes.map((node) => ({
      ...node,
      position: { ...node.position },
      data: sanitizeNodeData(node),
    })),
    edges: snapshot.edges.map((edge) => ({
      ...edge,
    })),
  };
}

function sanitizeSnapshot(snapshot: BoardSnapshot): BoardSnapshot {
  return {
    nodes: snapshot.nodes.map((node) => {
      if (isJunctionNode(node)) {
        return {
          ...node,
          type: 'junction',
          draggable: false,
          selectable: false,
          focusable: false,
          data: {
            junctionFor: (node.data as JunctionNodeData).junctionFor,
          },
        };
      }
      return {
        ...node,
        type: 'note',
        data: {
          title: (node.data as NoteNodeData)?.title ?? '',
          body: (node.data as NoteNodeData)?.body ?? '',
        },
      };
    }),
    edges: snapshot.edges.map((edge) => ({
      ...edge,
      sourceHandle: edge.sourceHandle ?? 'r-s',
      targetHandle: edge.targetHandle ?? 'l-t',
      type: 'smoothstep',
      markerEnd: {
        type: MarkerType.ArrowClosed,
      },
      style: {
        strokeWidth: 1.5,
      },
      animated: false,
    })),
  };
}

function nodeCenter(node: NoteNode): { x: number; y: number } {
  const width = (typeof node.width === 'number' && node.width > 0 ? node.width : undefined) ??
    (node.type === 'junction' ? JUNCTION_SIZE : NOTE_WIDTH);
  const height = (typeof node.height === 'number' && node.height > 0 ? node.height : undefined) ??
    (node.type === 'junction' ? JUNCTION_SIZE : NOTE_HEIGHT);
  return {
    x: node.position.x + width / 2,
    y: node.position.y + height / 2,
  };
}

function normalizeGraph(snapshot: BoardSnapshot, repositionJunctions: boolean): BoardSnapshot {
  const clean = sanitizeSnapshot(snapshot);
  const noteNodes = clean.nodes.filter((node) => isNoteNode(node));
  const noteMap = new Map(noteNodes.map((node) => [node.id, node]));

  const junctionNodes = clean.nodes.filter((node) => isJunctionNode(node));
  const junctionMap = new Map(junctionNodes.map((node) => [node.id, node]));
  const junctionByConclusion = new Map<string, NoteNode[]>();
  for (const junction of junctionNodes) {
    const conclusionId = (junction.data as JunctionNodeData).junctionFor;
    if (!noteMap.has(conclusionId)) {
      continue;
    }
    const list = junctionByConclusion.get(conclusionId) ?? [];
    list.push(junction);
    junctionByConclusion.set(conclusionId, list);
  }

  const inputByConclusion = new Map<string, Set<string>>();
  for (const edge of clean.edges) {
    if (!noteMap.has(edge.source)) {
      continue;
    }

    if (noteMap.has(edge.target)) {
      const list = inputByConclusion.get(edge.target) ?? new Set<string>();
      list.add(edge.source);
      inputByConclusion.set(edge.target, list);
      continue;
    }

    const junction = junctionMap.get(edge.target);
    if (!junction) {
      continue;
    }
    const conclusionId = (junction.data as JunctionNodeData).junctionFor;
    if (!noteMap.has(conclusionId)) {
      continue;
    }
    const list = inputByConclusion.get(conclusionId) ?? new Set<string>();
    list.add(edge.source);
    inputByConclusion.set(conclusionId, list);
  }

  const noteOrder = new Map<string, number>(noteNodes.map((node, index) => [node.id, index]));
  const normalizedNodes: NoteNode[] = noteNodes.map((node) => ({
    ...node,
    type: 'note',
    data: {
      title: (node.data as NoteNodeData)?.title ?? '',
      body: (node.data as NoteNodeData)?.body ?? '',
    },
  }));
  const normalizedEdges: NoteEdge[] = [];

  for (const conclusionNode of noteNodes) {
    const inputIds = Array.from(inputByConclusion.get(conclusionNode.id) ?? []);
    inputIds.sort((a, b) => (noteOrder.get(a) ?? 0) - (noteOrder.get(b) ?? 0));

    if (inputIds.length >= 2) {
      const existingJunction = junctionByConclusion.get(conclusionNode.id)?.[0];
      const fallback = existingJunction ? { ...existingJunction.position } : nodeCenter(conclusionNode);

      let nextPosition = fallback;
      if (repositionJunctions) {
        const inputsCenter = inputIds
          .map((inputId) => noteMap.get(inputId))
          .filter((node): node is NoteNode => Boolean(node))
          .map((node) => nodeCenter(node))
          .reduce(
            (acc, center, _, arr) => ({
              x: acc.x + center.x / arr.length,
              y: acc.y + center.y / arr.length,
            }),
            { x: 0, y: 0 },
          );
        const conclusionCenter = nodeCenter(conclusionNode);
        const junctionCenter = {
          x: inputsCenter.x * 0.35 + conclusionCenter.x * 0.65,
          y: inputsCenter.y * 0.35 + conclusionCenter.y * 0.65,
        };
        nextPosition = {
          x: junctionCenter.x - JUNCTION_SIZE / 2,
          y: junctionCenter.y - JUNCTION_SIZE / 2,
        };
      }

      const junctionId = existingJunction?.id ?? `j-${conclusionNode.id}-${nanoid(5)}`;
      normalizedNodes.push({
        id: junctionId,
        type: 'junction',
        position: nextPosition,
        draggable: false,
        selectable: false,
        focusable: false,
        data: {
          junctionFor: conclusionNode.id,
        },
      });

      for (const inputId of inputIds) {
        normalizedEdges.push(createEdge(inputId, junctionId));
      }
      normalizedEdges.push(createEdge(junctionId, conclusionNode.id));
      continue;
    }

    if (inputIds.length === 1) {
      normalizedEdges.push(createEdge(inputIds[0], conclusionNode.id));
    }
  }

  return sanitizeSnapshot({
    nodes: normalizedNodes,
    edges: normalizedEdges,
  });
}

function snapshotsEqual(a: BoardSnapshot, b: BoardSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function loadSnapshot(): BoardSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return emptySnapshot;
    }
    const parsed = JSON.parse(raw) as Partial<BoardSnapshot>;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      return emptySnapshot;
    }
    return normalizeGraph(
      {
        nodes: parsed.nodes as NoteNode[],
        edges: parsed.edges as NoteEdge[],
      },
      true,
    );
  } catch {
    return emptySnapshot;
  }
}

function withPresent(
  state: HistoryState,
  nextPresent: BoardSnapshot,
  recordHistory: boolean,
  normalize = true,
  repositionJunctions = true,
): HistoryState {
  const sanitized = normalize
    ? normalizeGraph(nextPresent, repositionJunctions)
    : sanitizeSnapshot(nextPresent);

  if (snapshotsEqual(state.present, sanitized)) {
    return state;
  }
  if (!recordHistory) {
    return {
      ...state,
      present: sanitized,
    };
  }
  return {
    past: [...state.past, cloneSnapshot(state.present)],
    present: sanitized,
    future: [],
  };
}

function historyReducer(state: HistoryState, action: Action): HistoryState {
  switch (action.type) {
    case 'APPLY_NODE_CHANGES': {
      const nodes = applyNodeChanges(action.changes, state.present.nodes);
      return withPresent(state, { ...state.present, nodes }, action.recordHistory, action.recordHistory, true);
    }
    case 'APPLY_EDGE_CHANGES': {
      const edges = applyEdgeChanges(action.changes, state.present.edges);
      return withPresent(state, { ...state.present, edges }, action.recordHistory, true, true);
    }
    case 'ADD_NODE': {
      const node: NoteNode = {
        id: nanoid(8),
        type: 'note',
        position: action.position,
        data: {
          title: action.title ?? '新标签',
          body: '',
        },
      };
      return withPresent(
        state,
        {
          ...state.present,
          nodes: [...state.present.nodes, node],
        },
        true,
      );
    }
    case 'UPDATE_NODE': {
      const nodes = state.present.nodes.map((node) => {
        if (node.id !== action.id || isJunctionNode(node)) {
          return node;
        }
        return {
          ...node,
          data: {
            title: action.title,
            body: action.body,
          },
        };
      });
      return withPresent(state, { ...state.present, nodes }, true);
    }
    case 'ADD_CONNECTION': {
      const newEdge: NoteEdge = {
        id: nanoid(10),
        source: action.connection.source,
        target: action.connection.target,
        sourceHandle: action.connection.sourceHandle ?? 'r-s',
        targetHandle: action.connection.targetHandle ?? 'l-t',
        type: 'smoothstep',
        markerEnd: {
          type: MarkerType.ArrowClosed,
        },
        style: {
          strokeWidth: 1.5,
        },
      };
      const edges = addEdge(newEdge, state.present.edges);
      return withPresent(state, { ...state.present, edges }, true);
    }
    case 'DUPLICATE_NODE': {
      const sourceNode = state.present.nodes.find((node) => node.id === action.id && isNoteNode(node));
      if (!sourceNode) {
        return state;
      }
      const noteData = sourceNode.data as NoteNodeData;
      const clone: NoteNode = {
        ...sourceNode,
        id: nanoid(8),
        selected: false,
        position: {
          x: sourceNode.position.x + 48,
          y: sourceNode.position.y + 48,
        },
        data: {
          title: noteData.title,
          body: noteData.body,
        },
      };
      const nodes = state.present.nodes.map((node) => ({
        ...node,
        selected: false,
      }));
      return withPresent(
        state,
        {
          ...state.present,
          nodes: [...nodes, clone],
        },
        true,
      );
    }
    case 'DELETE_SELECTION': {
      const nodeIdSet = new Set(action.nodeIds);
      const edgeIdSet = new Set(action.edgeIds);
      const nodes = state.present.nodes.filter((node) => !nodeIdSet.has(node.id));
      const edges = state.present.edges.filter((edge) => {
        if (edgeIdSet.has(edge.id)) {
          return false;
        }
        if (nodeIdSet.has(edge.source) || nodeIdSet.has(edge.target)) {
          return false;
        }
        return true;
      });
      return withPresent(state, { nodes, edges }, true);
    }
    case 'IMPORT_SNAPSHOT': {
      return {
        past: [],
        present: normalizeGraph(action.snapshot, true),
        future: [],
      };
    }
    case 'CLEAR': {
      return withPresent(state, emptySnapshot, true);
    }
    case 'UNDO': {
      if (state.past.length === 0) {
        return state;
      }
      const previous = state.past[state.past.length - 1];
      return {
        past: state.past.slice(0, -1),
        present: cloneSnapshot(previous),
        future: [cloneSnapshot(state.present), ...state.future],
      };
    }
    case 'REDO': {
      if (state.future.length === 0) {
        return state;
      }
      const next = state.future[0];
      return {
        past: [...state.past, cloneSnapshot(state.present)],
        present: cloneSnapshot(next),
        future: state.future.slice(1),
      };
    }
    case 'COMMIT_FROM_SNAPSHOT': {
      const normalizedPresent = normalizeGraph(state.present, true);
      if (snapshotsEqual(action.snapshot, normalizedPresent)) {
        return {
          ...state,
          present: normalizedPresent,
        };
      }
      return {
        past: [...state.past, cloneSnapshot(action.snapshot)],
        present: normalizedPresent,
        future: [],
      };
    }
    default:
      return state;
  }
}

export type BoardStore = {
  past: BoardSnapshot[];
  present: BoardSnapshot;
  future: BoardSnapshot[];
  canUndo: boolean;
  canRedo: boolean;
  applyNodeChanges: (changes: NodeChange[], recordHistory: boolean) => void;
  applyEdgeChanges: (changes: EdgeChange[], recordHistory: boolean) => void;
  addNode: (position: XYPosition, title?: string) => void;
  updateNode: (id: string, title: string, body: string) => void;
  addConnection: (connection: AddConnectionPayload) => void;
  duplicateNode: (id: string) => void;
  deleteSelection: (nodeIds: string[], edgeIds: string[]) => void;
  importSnapshot: (snapshot: BoardSnapshot) => void;
  clear: () => void;
  undo: () => void;
  redo: () => void;
  commitFromSnapshot: (snapshot: BoardSnapshot) => void;
};

export function useBoardStore(): BoardStore {
  const [state, dispatch] = useReducer(historyReducer, undefined, () => ({
    past: [],
    present: loadSnapshot(),
    future: [],
  }));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const payload = JSON.stringify({
        nodes: state.present.nodes.map((node) => ({
          ...node,
          data: sanitizeNodeData(node),
        })),
        edges: state.present.edges,
      });
      localStorage.setItem(STORAGE_KEY, payload);
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [state.present]);

  return useMemo(
    () => ({
      past: state.past,
      present: state.present,
      future: state.future,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      applyNodeChanges: (changes, recordHistory) =>
        dispatch({ type: 'APPLY_NODE_CHANGES', changes, recordHistory }),
      applyEdgeChanges: (changes, recordHistory) =>
        dispatch({ type: 'APPLY_EDGE_CHANGES', changes, recordHistory }),
      addNode: (position, title) => dispatch({ type: 'ADD_NODE', position, title }),
      updateNode: (id, title, body) => dispatch({ type: 'UPDATE_NODE', id, title, body }),
      addConnection: (connection) => dispatch({ type: 'ADD_CONNECTION', connection }),
      duplicateNode: (id) => dispatch({ type: 'DUPLICATE_NODE', id }),
      deleteSelection: (nodeIds, edgeIds) => dispatch({ type: 'DELETE_SELECTION', nodeIds, edgeIds }),
      importSnapshot: (snapshot) => dispatch({ type: 'IMPORT_SNAPSHOT', snapshot }),
      clear: () => dispatch({ type: 'CLEAR' }),
      undo: () => dispatch({ type: 'UNDO' }),
      redo: () => dispatch({ type: 'REDO' }),
      commitFromSnapshot: (snapshot) => dispatch({ type: 'COMMIT_FROM_SNAPSHOT', snapshot }),
    }),
    [state],
  );
}

export function cloneBoardSnapshot(snapshot: BoardSnapshot): BoardSnapshot {
  return cloneSnapshot(snapshot);
}

export function isNoteEditable(node: NoteNode): boolean {
  return isNoteNode(node);
}

