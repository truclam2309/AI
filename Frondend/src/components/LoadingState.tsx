import { LoaderCircleIcon } from 'lucide-react';

interface LoadingStateProps {
  label?: string;
}

export function LoadingState({ label = 'Đang tải...' }: LoadingStateProps) {
  return (
    <div role="status" className="flex flex-col items-center justify-center gap-3 py-16 text-muted">
      <LoaderCircleIcon className="h-6 w-6 animate-spin text-brand" aria-hidden="true" />
      <p className="text-sm">{label}</p>
    </div>);

}
