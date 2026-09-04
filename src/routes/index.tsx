import { createFileRoute } from "@tanstack/react-router";
import { Landing } from "@/components/rug/landing";

export const Route = createFileRoute("/")({
  component: Landing,
});
