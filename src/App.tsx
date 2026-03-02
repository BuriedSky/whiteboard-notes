import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlowProvider } from 'reactflow';
import type { ChangeEvent } from 'react';
import type { Connection, EdgeChange, NodeChange, OnSelectionChangeParams } from 'reactflow';
import Board from './canvas/Board';
import type { BoardHandle } from './canvas/Board';
import { cloneBoardSnapshot, isNoteEditable, useBoardStore } from './state/store';
import { exportBoardToJson, exportBoardToPng, importBoardFromJson } from './utils/export';

type StatusTone = 'ok' | 'warn';

function App() {
  const store = useBoardStore();
  const boardRef = useRef<BoardHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragSnapshotRef = useRef(cloneBoardSnapshot(store.present));
  const statusTimerRef = useRef<number | null>(null);

  const [connectMode, setConnectMode] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ text: string; tone: StatusTone } | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');

  const selectedNode = useMemo(() => {
    const node = store.present.nodes.find((item) => item.id === selectedNodeId) ?? null;
    if (!node || !isNoteEditable(node)) {
      return null;
    }
    return node;
  }, [selectedNodeId, store.present.nodes]);

  const showStatus = useCallback((text: string, tone: StatusTone = 'ok') => {
    if (statusTimerRef.current) {
      window.clearTimeout(statusTimerRef.current);
    }
    setStatus({ text, tone });
    statusTimerRef.current = window.setTimeout(() => {
      setStatus(null);
    }, 1500);
  }, []);

  useEffect(() => {
    if (!selectedNode) {
      setDraftTitle('');
      setDraftBody('');
      return;
    }
    setDraftTitle((selectedNode.data as { title?: string }).title ?? '');
    setDraftBody((selectedNode.data as { body?: string }).body ?? '');
  }, [selectedNode]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      showStatus('已自动保存');
    }, 360);

    return () => {
      window.clearTimeout(timer);
    };
  }, [store.present, showStatus]);

  useEffect(() => {
    return () => {
      if (statusTimerRef.current) {
        window.clearTimeout(statusTimerRef.current);
      }
    };
  }, []);

  const saveSelectedNode = useCallback(() => {
    if (!selectedNode) {
      return;
    }
    store.updateNode(selectedNode.id, draftTitle.trim(), draftBody);
    showStatus('节点已保存');
  }, [draftBody, draftTitle, selectedNode, showStatus, store]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const structural = changes.some((change) => change.type === 'add' || change.type === 'remove');
      store.applyNodeChanges(changes, structural);
    },
    [store],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const structural = changes.some((change) => change.type === 'add' || change.type === 'remove');
      store.applyEdgeChanges(changes, structural);
    },
    [store],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connectMode || !connection.source || !connection.target) {
        return;
      }
      store.addConnection({
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? 'r-s',
        targetHandle: connection.targetHandle ?? 'l-t',
      });
    },
    [connectMode, store],
  );

  const handleSelectionChange = useCallback((selection: OnSelectionChangeParams) => {
    if (selection.nodes.length > 0 && selection.nodes[0].type !== 'junction') {
      setSelectedNodeId(selection.nodes[0].id);
      return;
    }
    setSelectedNodeId(null);
  }, []);

  const handleNodeDragStart = useCallback(() => {
    dragSnapshotRef.current = cloneBoardSnapshot(store.present);
  }, [store.present]);

  const handleNodeDragStop = useCallback(() => {
    store.commitFromSnapshot(dragSnapshotRef.current);
  }, [store]);

  const createNodeInCenter = useCallback(() => {
    boardRef.current?.createNodeAtViewportCenter();
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;

      if (isTyping) {
        return;
      }

      const key = event.key.toLowerCase();
      const ctrlOrMeta = event.ctrlKey || event.metaKey;

      if (!ctrlOrMeta && key === 'n') {
        event.preventDefault();
        createNodeInCenter();
        return;
      }

      if (!ctrlOrMeta && key === 'l') {
        event.preventDefault();
        setConnectMode((prev) => !prev);
        return;
      }

      if (ctrlOrMeta && key === 'd') {
        if (!selectedNodeId) {
          return;
        }
        event.preventDefault();
        store.duplicateNode(selectedNodeId);
        showStatus('已复制节点');
        return;
      }

      if (ctrlOrMeta && key === 'z' && event.shiftKey) {
        event.preventDefault();
        store.redo();
        return;
      }

      if (ctrlOrMeta && key === 'z') {
        event.preventDefault();
        store.undo();
        return;
      }

      if (ctrlOrMeta && key === 'y') {
        event.preventDefault();
        store.redo();
      }
    };

    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, [createNodeInCenter, selectedNodeId, showStatus, store]);

  const onExportPng = useCallback(async () => {
    try {
      const viewport = boardRef.current?.getViewportElement();
      if (!viewport) {
        return;
      }
      const filename = await exportBoardToPng(viewport);
      showStatus(`导出成功: ${filename}`);
    } catch {
      showStatus('导出 PNG 失败', 'warn');
    }
  }, [showStatus]);

  const onExportJson = useCallback(() => {
    const filename = exportBoardToJson(store.present);
    showStatus(`导出成功: ${filename}`);
  }, [showStatus, store.present]);

  const onImportJsonClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onImportJsonFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) {
        return;
      }
      try {
        const snapshot = await importBoardFromJson(file);
        store.importSnapshot(snapshot);
        setSelectedNodeId(null);
        showStatus('导入成功');
      } catch {
        showStatus('导入失败：文件格式错误', 'warn');
      }
    },
    [showStatus, store],
  );

  const onClear = useCallback(() => {
    if (!window.confirm('确定清空画布吗？此操作可撤销。')) {
      return;
    }
    if (!window.confirm('再次确认：要清空全部节点与连线吗？')) {
      return;
    }
    store.clear();
    setSelectedNodeId(null);
    showStatus('画布已清空');
  }, [showStatus, store]);

  return (
    <ReactFlowProvider>
      <div className="app-shell">
        <header className="toolbar">
          <button onClick={createNodeInCenter}>新建标签 (N)</button>
          <button className={connectMode ? 'active' : ''} onClick={() => setConnectMode((prev) => !prev)}>
            连线模式 (L): {connectMode ? '开' : '关'}
          </button>
          <button className={showGrid ? 'active' : ''} onClick={() => setShowGrid((prev) => !prev)}>
            网格: {showGrid ? '开' : '关'}
          </button>
          <button onClick={onExportPng}>导出 PNG</button>
          <button onClick={onExportJson}>导出 JSON</button>
          <button onClick={onImportJsonClick}>导入 JSON</button>
          <button className="danger" onClick={onClear}>
            清空
          </button>
          <button disabled={!store.canUndo} onClick={store.undo}>
            撤销
          </button>
          <button disabled={!store.canRedo} onClick={store.redo}>
            重做
          </button>
        </header>

        <main className="workspace">
          <Board
            ref={boardRef}
            nodes={store.present.nodes}
            edges={store.present.edges}
            connectMode={connectMode}
            showGrid={showGrid}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            onNodeDoubleClick={setSelectedNodeId}
            onSelectionChange={handleSelectionChange}
            onNodeDragStart={handleNodeDragStart}
            onNodeDragStop={handleNodeDragStop}
            onCreateNode={(position) => store.addNode(position, '新标签')}
          />

          {selectedNode ? (
            <aside className="editor-panel">
              <h3>节点编辑</h3>
              <label htmlFor="title">Title</label>
              <input id="title" value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} />
              <label htmlFor="body">Body</label>
              <textarea id="body" rows={8} value={draftBody} onChange={(e) => setDraftBody(e.target.value)} />
              <button onClick={saveSelectedNode}>保存</button>
            </aside>
          ) : null}
        </main>

        {status ? <div className={`status-tip ${status.tone}`}>{status.text}</div> : null}

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden-input"
          onChange={onImportJsonFile}
        />
      </div>
    </ReactFlowProvider>
  );
}

export default App;
