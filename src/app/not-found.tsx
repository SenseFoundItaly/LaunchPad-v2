export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-6">
      <div className="max-w-md text-center">
        <h2 className="text-lg font-semibold text-zinc-100 mb-2">
          Page not found
        </h2>
        <p className="text-sm text-zinc-400 mb-6">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <a
          href="/"
          className="px-4 py-2 text-sm font-medium rounded-md bg-zinc-800 text-zinc-100 hover:bg-zinc-700 transition-colors"
        >
          Go home
        </a>
      </div>
    </div>
  );
}
