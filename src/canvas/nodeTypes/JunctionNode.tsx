import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';
import type { JunctionNodeData } from '../../state/store';

function JunctionNode({ data }: NodeProps<JunctionNodeData>) {
  return (
    <div className="junction-node" aria-hidden>
      <Handle
        id="l-t"
        type="target"
        position={Position.Left}
        className="junction-handle"
        isConnectable={Boolean(data.connectMode)}
      />
      <Handle
        id="r-s"
        type="source"
        position={Position.Right}
        className="junction-handle"
        isConnectable={Boolean(data.connectMode)}
      />
    </div>
  );
}

export default memo(JunctionNode);
