import type { ReactNode } from 'react';

export function ErrorNotice({ error }: { error: Error | undefined | null }) {
  if (!error) return null;
  return (
    <div className="notice error" role="alert">
      {error.message}
    </div>
  );
}

export function Notice({
  kind,
  children,
}: {
  kind: 'warning' | 'success' | 'error';
  children: ReactNode;
}) {
  return <div className={`notice ${kind}`}>{children}</div>;
}
