import { Background, BackgroundVariant, Controls, MarkerType, ReactFlow } from 'reactflow';
import type {
  Connection,
  Edge,
  EdgeChange,
  NodeChange,
  OnSelectionChangeParams,
  ReactFlowInstance,
  XYPosition,
} from 'reactflow';
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import NoteNodeComponent from './nodeTypes/NoteNode';
import JunctionNodeComponent from './nodeTypes/JunctionNode';
import type { JunctionNodeData, NoteEdge, NoteNode, NoteNodeData } from '../state/store';

const defaultEdgeOptions: Partial<Edge> = {
  type: 'smoothstep',
  markerEnd: {
    type: MarkerType.ArrowClosed,
    color: '#b8860b',
    width: 14,
    height: 14,
  },
  style: {
    stroke: 'rgba(0, 0, 0, 0.18)',
    strokeWidth: 1.4,
  },
};

export type BoardHandle = {
  createNodeAtViewportCenter: () => void;
  getViewportElement: () => HTMLDivElement | null;
};

type BoardProps = {
  nodes: NoteNode[];
  edges: NoteEdge[];
  connectMode: boolean;
  showGrid: boolean;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  onNodeDoubleClick: (id: string) => void;
  onSelectionChange: (selection: OnSelectionChangeParams) => void;
  onNodeDragStart: () => void;
  onNodeDragStop: () => void;
  onCreateNode: (position: XYPosition) => void;
};

function normalizeTitle(title: string | undefined): string {
  if (!title || !title.trim()) {
    return '(无标题)';
  }
  return title.trim();
}

function formulaFromInputs(inputs: string[], targetTitle: string): string {
  if (inputs.length === 0) {
    return '';
  }
  if (inputs.length === 1) {
    return `${inputs[0]} => ${targetTitle}`;
  }
  if (inputs.length === 2) {
    return `${inputs[0]} + ${inputs[1]} => ${targetTitle}`;
  }
  return `${inputs[0]} + ${inputs[1]} + ... => ${targetTitle}`;
}

const Board = forwardRef<BoardHandle, BoardProps>(function Board(
  {
    nodes,
    edges,
    connectMode,
    showGrid,
    onNodesChange,
    onEdgesChange,
    onConnect,
    onNodeDoubleClick,
    onSelectionChange,
    onNodeDragStart,
    onNodeDragStop,
    onCreateNode,
  },
  ref,
) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);

  const nodeTypes = useMemo(
    () => ({
      note: NoteNodeComponent,
      junction: JunctionNodeComponent,
    }),
    [],
  );

  const titleAndTypeKey = useMemo(
    () =>
      nodes
        .map((node) => {
          if (node.type === 'junction') {
            return `${node.id}:j:${(node.data as JunctionNodeData).junctionFor}`;
          }
          return `${node.id}:n:${(node.data as NoteNodeData).title ?? ''}`;
        })
        .sort()
        .join('|'),
    [nodes],
  );

  const formulaMap = useMemo(() => {
    const noteIds = new Set<string>();
    const titleMap = new Map<string, string>();
    const junctionForMap = new Map<string, string>();

    for (const node of nodes) {
      if (node.type === 'junction') {
        const data = node.data as JunctionNodeData;
        if (typeof data.junctionFor === 'string') {
          junctionForMap.set(node.id, data.junctionFor);
        }
      } else {
        const data = node.data as NoteNodeData;
        noteIds.add(node.id);
        titleMap.set(node.id, normalizeTitle(data.title));
      }
    }

    const incomingMap = new Map<string, string[]>();
    for (const edge of edges) {
      if (!noteIds.has(edge.source)) {
        continue;
      }
      const sourceTitle = titleMap.get(edge.source) ?? '(无标题)';

      if (noteIds.has(edge.target)) {
        const list = incomingMap.get(edge.target) ?? [];
        list.push(sourceTitle);
        incomingMap.set(edge.target, list);
        continue;
      }

      const conclusionId = junctionForMap.get(edge.target);
      if (!conclusionId) {
        continue;
      }
      const list = incomingMap.get(conclusionId) ?? [];
      list.push(sourceTitle);
      incomingMap.set(conclusionId, list);
    }

    const nextMap = new Map<string, string>();
    for (const node of nodes) {
      if (node.type === 'junction') {
        continue;
      }
      const targetTitle = titleMap.get(node.id) ?? '(无标题)';
      nextMap.set(node.id, formulaFromInputs(incomingMap.get(node.id) ?? [], targetTitle));
    }

    return nextMap;
  }, [edges, nodes, titleAndTypeKey]);

  const displayNodes = useMemo(
    () =>
      nodes.map((node) => {
        if (node.type === 'junction') {
          return {
            ...node,
            data: {
              ...(node.data as JunctionNodeData),
              connectMode,
            },
          };
        }
        return {
          ...node,
          data: {
            ...(node.data as NoteNodeData),
            formulaText: formulaMap.get(node.id) ?? '',
            connectMode,
          },
        };
      }),
    [nodes, connectMode, formulaMap],
  );

  const createNodeAtViewportCenter = useCallback(() => {
    if (!rfInstance || !boardRef.current) {
      return;
    }
    const rect = boardRef.current.getBoundingClientRect();
    const position = rfInstance.screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    onCreateNode(position);
  }, [onCreateNode, rfInstance]);

  useImperativeHandle(
    ref,
    () => ({
      createNodeAtViewportCenter,
      getViewportElement: () => boardRef.current,
    }),
    [createNodeAtViewportCenter],
  );

  return (
    <div ref={boardRef} className="board-wrap" id="whiteboard-canvas">
      <ReactFlow
        nodes={displayNodes}
        edges={edges}
        defaultEdgeOptions={defaultEdgeOptions}
        onInit={setRfInstance}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDoubleClick={(_, node) => {
          if (node.type !== 'junction') {
            onNodeDoubleClick(node.id);
          }
        }}
        onSelectionChange={onSelectionChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        nodeTypes={nodeTypes}
        fitView
        deleteKeyCode="Delete"
        multiSelectionKeyCode={['Control', 'Meta']}
        selectionOnDrag={!connectMode}
        elementsSelectable
      >
        {showGrid ? (
          <Background variant={BackgroundVariant.Dots} gap={18} size={0.9} color="rgba(0,0,0,0.06)" />
        ) : null}
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
});

export default Board;
