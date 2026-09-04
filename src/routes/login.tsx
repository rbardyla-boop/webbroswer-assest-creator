import { createFileRoute, Link } from "@tanstack/react-router";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  return (
    <main className="ledger-field grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-sm">
        <Link to="/" className="font-display text-2xl tracking-tight">
          RUG
        </Link>
        <h1 className="mt-8 font-display text-3xl tracking-tight">Enter the world.</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Not a sixth person in the meeting. A shared ledger. Sign in to join a match.
        </p>
        <div className="mt-8 flex flex-col gap-2">
          {authEnabled ? (
            GROK_PROVIDERS.map((p, i) => (
              <Button
                key={p.providerId}
                variant={i === 0 ? "primary" : "outline"}
                className="w-full whitespace-nowrap"
                size="lg"
                onClick={() => void signIn(p.providerId, { callbackURL: "/" })}
              >
                Continue with {p.label}
              </Button>
            ))
          ) : (
            <p className="text-sm text-muted">Sign-in is disabled.</p>
          )}
        </div>
      </div>
    </main>
  );
}
