import { createFileRoute } from "@tanstack/react-router";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Desk } from "@/components/rug/desk";

export const Route = createFileRoute("/world/$code")({
  component: WorldPage,
});

function WorldPage() {
  const { code } = Route.useParams();
  const { user, isPending } = useCurrentUserState();
  if (isPending) {
    return <div className="grid min-h-dvh place-items-center bg-bg text-muted">Loading…</div>;
  }
  if (!user) return <RedirectToSignIn />;
  return <Desk code={code.toUpperCase()} />;
}
