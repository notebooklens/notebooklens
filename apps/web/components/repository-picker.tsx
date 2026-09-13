"use client";

import { useId, useState } from "react";
import type { RepositoryPage } from "@/lib/types";
import styles from "./repository-picker.module.css";

export function RepositoryPicker({ page }: { page: RepositoryPage }) {
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const filterId = useId();
  const selected = page.repositories.find(repo => repo.id === selectedId);
  const matches = page.repositories.filter(repo => repo.full_name.toLowerCase().includes(filter.toLowerCase().trim()));
  return <section className={styles.picker} aria-label="Repository reviews">
    {selected ? <>
      <button className={styles.back} type="button" onClick={() => setSelectedId(null)}>← Repositories</button>
      <h2>{selected.full_name}</h2>
      <p>Available notebook pull request reviews</p>
      {selected.reviews.length ? <ul className={styles.list}>
        {selected.reviews.map(review => <li key={review.id}>
          <a className={styles.row} href={review.href}>
            <strong>Pull request #{review.pull_number}</strong>
            <span>{review.status.replaceAll("_", " ")} <span aria-hidden="true">→</span></span>
          </a>
        </li>)}
      </ul> : <p role="status">No notebook reviews are available for this repository yet. Open a notebook pull request with the GitHub App installed.</p>}
    </> : <>
      <h2>Select a repository</h2>
      <label htmlFor={filterId}>Filter loaded repositories</label>
      <input id={filterId} type="search" placeholder="Repository name" value={filter} onChange={event => setFilter(event.target.value)} />
      <p className={styles.caption}>Repositories the App knows about and your GitHub account can access.</p>
      {matches.length ? <ul className={styles.list}>
        {matches.map(repo => <li key={repo.id}>
          <button className={styles.row} type="button" onClick={() => setSelectedId(repo.id)}>
            <strong>{repo.full_name}</strong>
            <span>{repo.reviews.length ? `${repo.reviews.length} recent review${repo.reviews.length === 1 ? "" : "s"}` : "No reviews yet"} <span aria-hidden="true">→</span></span>
          </button>
        </li>)}
      </ul> : <p role="status">{filter ? "No loaded repositories match this filter." : "No accessible repositories on this page."}</p>}
      {page.next_cursor ? <a className={styles.back} href={`/?cursor=${encodeURIComponent(page.next_cursor)}`}>Next repositories →</a> : null}
      <p className={styles.caption}>Missing a review? You can also open its NotebookLens check on GitHub. This list shows a bounded set of recent reviews, not every notebook or commit.</p>
    </>}
  </section>;
}
