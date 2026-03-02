import { toPng } from 'html-to-image';
import type { BoardSnapshot, JunctionNodeData, NoteNodeData } from '../state/store';

function timestampString(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportBoardToPng(element: HTMLElement): Promise<string> {
  const dataUrl = await toPng(element, {
    cacheBust: true,
    backgroundColor: '#ffffff',
    pixelRatio: 2,
  });

  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const filename = `whiteboard-${timestampString()}.png`;
  downloadBlob(blob, filename);
  return filename;
}

export function exportBoardToJson(snapshot: BoardSnapshot): string {
  const payload = JSON.stringify(
    {
      nodes: snapshot.nodes.map((node) => {
        if (node.type === 'junction') {
          return {
            ...node,
            data: {
              junctionFor: (node.data as JunctionNodeData).junctionFor,
            },
          };
        }
        return {
          ...node,
          data: {
            title: (node.data as NoteNodeData).title,
            body: (node.data as NoteNodeData).body,
          },
        };
      }),
      edges: snapshot.edges,
    },
    null,
    2,
  );

  const filename = `whiteboard-${timestampString()}.json`;
  downloadBlob(new Blob([payload], { type: 'application/json' }), filename);
  return filename;
}

export async function importBoardFromJson(file: File): Promise<BoardSnapshot> {
  const text = await file.text();
  const parsed = JSON.parse(text) as Partial<BoardSnapshot>;
  if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
    throw new Error('无效 JSON：必须包含 nodes 和 edges 数组');
  }
  return {
    nodes: parsed.nodes,
    edges: parsed.edges,
  };
}
