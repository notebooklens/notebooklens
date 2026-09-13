import { createRoot } from "react-dom/client";
import { RepositoryPicker } from "../components/repository-picker";
import styles from "../components/repository-picker.module.css";
import type { RepositoryPage } from "../lib/types";

const page: RepositoryPage = {
  repositories: [
    { id: "one", owner: "example", name: "forecast", full_name: "example/forecast", reviews: [{ id: "review-one", pull_number: 12, status: "ready", href: "/reviews/example/forecast/pulls/12/snapshots/1" }] },
    { id: "two", owner: "example", name: "empty", full_name: "example/empty", reviews: [] },
    { id: "three", owner: "example", name: "long", full_name: "example/long-repository-name-for-demand-forecasting-and-notebook-experiments", reviews: [{ id: "review-two", pull_number: 31, status: "in_progress", href: "/reviews/example/long/pulls/31/snapshots/1" }] },
  ],
  next_cursor: "synthetic cursor/+?",
};
if (new URLSearchParams(location.search).has("empty")) {
  page.repositories = [];
  page.next_cursor = null;
}
createRoot(document.getElementById("root")!).render(<main className={styles.page}>
  <header className={styles.header}><h1>NotebookLens</h1></header>
  <RepositoryPicker page={page} />
</main>);
