'use client';

interface DraftPreviewProps {
  html: string;
}

export default function DraftPreview({ html }: DraftPreviewProps) {
  return (
    <div className="w-full h-full bg-white rounded-lg overflow-hidden">
      <iframe
        srcDoc={html}
        sandbox="allow-scripts allow-same-origin"
        className="w-full h-full border-0"
        title="Draft preview"
      />
    </div>
  );
}
