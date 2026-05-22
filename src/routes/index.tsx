import { createFileRoute } from "@tanstack/react-router";
import { MCQApp } from "@/components/MCQApp";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return <MCQApp />;
}
