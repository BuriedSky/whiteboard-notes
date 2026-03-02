import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';
import type { NoteNodeData } from '../../state/store';

function NoteNode({ data, selected }: NodeProps<NoteNodeData>) {
  const title = data.title.trim() || '(无标题)';

  return (
    <div className={`note-node ${selected ? 'is-selected' : ''}`}>
      {data.formulaText ? <div className="note-formula">{data.formulaText}</div> : null}
      <div className="note-title">{title}</div>
      {data.body ? <div className="note-body">{data.body}</div> : null}

      <Handle
        id="l-t"
        type="target"
        position={Position.Left}
        className="note-handle note-handle-left"
        isConnectable={Boolean(data.connectMode)}
      />
      <Handle
        id="r-s"
        type="source"
        position={Position.Right}
        className="note-handle note-handle-right"
        isConnectable={Boolean(data.connectMode)}
      />
    </div>
  );
}

export default memo(NoteNode);
