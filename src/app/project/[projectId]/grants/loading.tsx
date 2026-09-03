import RouteSkeleton from '@/components/ui/RouteSkeleton';

/**
 * Instant shell for this route. Without a loading boundary the App Router has
 * nothing renderable to prefetch on a dynamic route, so a click left the old
 * page frozen for the whole server round-trip.
 */
export default function Loading() {
  return <RouteSkeleton variant="list" />;
}
