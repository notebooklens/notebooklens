"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { submitAiGatewaySettingsAction } from "@/lib/actions";
import type { AiGatewayActionState } from "@/lib/types";
import styles from "./ai-gateway-settings.module.css";

type AiGatewaySettingsFormProps = {
  initialState: AiGatewayActionState;
  installationLabel: string;
  returnTo: string;
};

export function AiGatewaySettingsForm({ initialState, installationLabel, returnTo }: AiGatewaySettingsFormProps) {
  const [state, formAction, pending] = useActionState(submitAiGatewaySettingsAction, initialState);
  const formKey = JSON.stringify({ updatedAt: state.config.updated_at, form: state.form, notice: state.notice, endpoint: state.tested_endpoint });

  return (
    <form action={formAction} className={styles.form} key={formKey} aria-label="AI gateway configuration" aria-busy={pending} onInvalidCapture={(event) => {
      const target = event.target as HTMLElement;
      for (let ancestor = target.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
      }
      // WebKit may validate before the opened disclosure is laid out.
      if (event.currentTarget.querySelector("input:invalid,select:invalid,textarea:invalid") === target) {
        window.requestAnimationFrame(() => target.focus());
      }
    }}>
      <input name="returnTo" type="hidden" value={returnTo} />
      <input name="installationId" type="hidden" value={state.config.installation_id} />
      <input name="existingConfigJson" type="hidden" value={JSON.stringify(state.config)} />
      <div role={state.notice?.tone === "error" ? "alert" : "status"} aria-live={state.notice?.tone === "error" ? "assertive" : "polite"} aria-atomic="true">
        {state.notice ? <p className={state.notice.tone === "error" ? styles.errorNotice : styles.successNotice}>{state.notice.message}</p> : null}
      </div>

      <fieldset className={styles.fields} disabled={pending}>
        <section className={styles.section} aria-labelledby="ai-endpoint-heading">
          <h2 id="ai-endpoint-heading">Gateway and model</h2>
          <p>Use your installation’s LiteLLM URL and model alias.</p>
          <div className={styles.grid}>
            <label>Display name<input defaultValue={state.form.display_name} name="displayName" required type="text" /></label>
            <label>Model name<input defaultValue={state.form.model_name} name="modelName" placeholder="Your gateway model alias" required type="text" /></label>
            <label className={styles.fullWidth}>Gateway base URL<input defaultValue={state.form.base_url} name="baseUrl" placeholder="https://gateway.example/v1" required type="url" spellCheck={false} aria-describedby="ai-base-help" /></label>
          </div>
          <p id="ai-base-help" className={styles.help}>Use the API base URL, including its version path if required by your gateway.</p>
        </section>

        <section className={styles.section} aria-labelledby="ai-auth-heading">
          <h2 id="ai-auth-heading">Authentication</h2>
          <div className={styles.grid}>
            <label>API key header<input defaultValue={state.form.api_key_header_name} name="apiKeyHeaderName" required type="text" spellCheck={false} /></label>
            <label>API key<input defaultValue={state.form.api_key} name="apiKey" type="password" autoComplete="new-password" spellCheck={false} placeholder={state.config.has_api_key ? "Leave blank to keep stored key" : "Enter a gateway key if required"} aria-describedby="ai-key-help" /></label>
          </div>
          <p id="ai-key-help" className={styles.help}>{state.config.has_api_key ? "A key is stored. Its value is never shown; leave this field blank to keep it." : "No key is stored. Supply the full header value expected by your gateway, including Bearer if needed."}</p>
        </section>

        <section className={styles.section} aria-labelledby="ai-activation-heading">
          <h2 id="ai-activation-heading">Managed AI review</h2>
          <label className={styles.checkbox}><input defaultChecked={state.form.active} name="active" type="checkbox" />Enable the gateway for this installation</label>
          <p className={styles.help}>This choice takes effect when you save. Testing does not save or activate the gateway.</p>
          <p className={styles.savedState}>Saved state: {state.config.active ? "enabled" : "disabled"} · {installationLabel}</p>
        </section>

        <details className={styles.advanced} open={state.notice?.tone === "error" || undefined}>
          <summary>Advanced settings <span>GitHub host, request format and routing headers</span></summary>
          <section className={styles.section} aria-labelledby="ai-host-heading">
            <h2 id="ai-host-heading">GitHub host</h2>
            <p>Defaults match GitHub.com. Change these only for the host that owns this installation.</p>
            <div className={styles.grid}>
              <label>GitHub host kind<select defaultValue={state.form.github_host_kind} name="githubHostKind"><option value="github_com">GitHub.com</option><option value="ghes">GitHub Enterprise Server</option></select></label>
              <label>GitHub API base URL<input defaultValue={state.form.github_api_base_url} name="githubApiBaseUrl" required type="url" /></label>
              <label className={styles.fullWidth}>GitHub web base URL<input defaultValue={state.form.github_web_base_url} name="githubWebBaseUrl" required type="url" /></label>
            </div>
          </section>
          <section className={styles.section} aria-labelledby="ai-runtime-heading">
            <h2 id="ai-runtime-heading">Request format and routing</h2>
            <label className={styles.checkbox}><input defaultChecked={state.form.use_responses_api} name="useResponsesApi" type="checkbox" />Use the Responses-compatible endpoint</label>
            <p className={styles.help}>Enable only if your gateway and selected model support this request format.</p>
            <label>LiteLLM virtual key ID<input defaultValue={state.form.litellm_virtual_key_id} name="litellmVirtualKeyId" placeholder="Optional routing identifier" type="text" /></label>
          </section>
          <section className={styles.section} aria-labelledby="ai-headers-heading">
            <h2 id="ai-headers-heading">Static request headers</h2>
            <p className={styles.help}>Optional tenant or routing headers. Stored names: {state.config.static_header_names.length ? state.config.static_header_names.join(", ") : "none"}. Values are not read back.</p>
            <label className={styles.checkbox}><input defaultChecked={state.form.replace_static_headers} name="replaceStaticHeaders" type="checkbox" />Replace stored static headers</label>
            <label>Header lines<textarea defaultValue={state.form.static_headers_text} name="staticHeadersText" placeholder={"X-Tenant: value\nX-Workspace: notebooklens"} rows={4} spellCheck={false} aria-describedby="ai-headers-help" /></label>
            <p id="ai-headers-help" className={styles.help}>Use one Header-Name: value per line. When replacement is selected, these lines replace the entire stored set; leaving them empty clears it.</p>
          </section>
        </details>
      </fieldset>

      {state.tested_endpoint ? <p className={styles.help}>Last successful test used <code>{state.tested_endpoint}</code>. Changes made since that test have not been verified.</p> : null}
      <div className={styles.actions}>
        <p>Save updates settings without running a connection test.</p>
        <div className={styles.actionButtons}><SubmitButton value="test" /><SubmitButton value="save" /></div>
      </div>
      <SubmissionStatus />
    </form>
  );
}

function SubmitButton({ value }: { value: "test" | "save" }) {
  const { pending, data } = useFormStatus();
  const selected = data?.get("intent") === value;
  return <button className={value === "save" ? styles.primaryButton : styles.secondaryButton} disabled={pending} name="intent" type="submit" value={value}>{pending && selected ? value === "test" ? "Testing…" : "Saving…" : value === "test" ? "Test connection" : "Save settings"}</button>;
}

function SubmissionStatus() {
  const { pending, data } = useFormStatus();
  return <p className={styles.pending} role="status" aria-live="polite">{pending ? data?.get("intent") === "test" ? "Testing the gateway. Settings are not being saved." : "Saving gateway settings. Please wait." : ""}</p>;
}
