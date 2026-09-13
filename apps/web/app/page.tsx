import { ApiRequestError, getRepositories, getSessionIdentity } from "@/lib/api";
import { buildLoginHref } from "@/lib/public-hrefs";
import { RepositoryPicker } from "@/components/repository-picker";
import { WorkspaceTopbar } from "@/components/workspace-topbar";
import styles from "@/components/repository-picker.module.css";
import { readFlashNotice } from "@/lib/review-workspace";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function HomePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const notice = readFlashNotice(params);
  let login: string | null = null;
  let content;
  try {
    const session = await getSessionIdentity();
    login = session.user.login;
    const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
    const repositories = await getRepositories(cursor);
    content = <RepositoryPicker page={repositories} />;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      login = null;
      content = <section className={styles.entry}>
        <h2>Review your notebooks</h2>
        <p>Sign in to choose a repository and open its notebook pull request reviews.</p>
        <a className={styles.signIn} href={buildLoginHref("/")}>Continue with GitHub</a>
        <p className={styles.caption}>Need to connect a repository? <a href="https://notebooklens.github.io/notebooklens/quickstart-workspace/">Workspace setup guide</a></p>
      </section>;
    } else {
      content = <section className={styles.entry}>
        <h2>Could not load your repositories</h2>
        <p role="alert">NotebookLens could not load the repository list. Your sign-in status has not been changed.</p>
        <form action="/" method="get"><button className={styles.back} type="submit">Try again</button></form>
        <p className={styles.caption}>You can also open an existing review from its GitHub check.</p>
      </section>;
    }
  }
  return <div className={styles.page}>
    <WorkspaceTopbar skipHref="#repository-content">
      {login ? <div className={styles.identity}>
        <span>Signed in as {login}</span>
        <form action="/actions/auth/logout" method="post"><input type="hidden" name="returnTo" value="/" /><button className="workspace-topbar-action" type="submit">Sign out</button></form>
      </div> : null}
    </WorkspaceTopbar>
    <main id="repository-content" tabIndex={-1}>
    <h1 className="sr-only">Notebook reviews</h1>
    {notice ? <p className={styles.entry} role={notice.tone === "error" ? "alert" : "status"}>{notice.message}</p> : null}
    {content}
    </main>
  </div>;
}
