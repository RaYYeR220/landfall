/** External links used across the site. The repository URL comes from the deployment. */
export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? "";
export const REPO_LABEL = REPO_URL.includes("gitlab") ? "GitLab" : "GitHub";
/** The README is the docs; without a repository URL, fall back to the on-page explainer. */
export const DOCS_URL = REPO_URL ? `${REPO_URL}#readme` : "/#how";
export const APP_URL = "/app";
export const VAULT_URL = "/vault";
