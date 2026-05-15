export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-sunk px-6">
      <div className="max-w-md text-center">
        <h2 className="text-lg font-semibold text-ink mb-2">
          Page not found
        </h2>
        <p className="text-sm text-ink-4 mb-6">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <a
          href="/"
          className="px-4 py-2 text-sm font-medium rounded-md bg-paper-2 text-ink hover:bg-paper-3 transition-colors"
        >
          Go home
        </a>
      </div>
    </div>
  );
}
