/**
 * A minimal saved-widget manager for standard ipywidgets 8
 * (`@jupyter-widgets/base`, `@jupyter-widgets/controls`) only.
 *
 * This intentionally does NOT use `@jupyter-widgets/html-manager`'s
 * `HTMLManager`: that class always constructs a full
 * `@jupyterlab/rendermime` `RenderMimeRegistry` in its constructor (needed
 * only to render `@jupyter-widgets/output` widgets, which NotebookLens
 * deliberately does not support — see `SUPPORTED_WIDGET_MODULES` in
 * `lib/interactive-output.ts`). That registry eagerly JIT-compiles ajv
 * JSON-schema validators via `new Function(...)`, which is why using
 * `HTMLManager` would otherwise force `'unsafe-eval'` into this sandboxed
 * renderer's CSP. Since we never instantiate an Output widget, we can skip
 * that registry entirely and avoid the eval requirement.
 *
 * Only ipywidgets 8's module major version is supported; older ipywidgets 7
 * saved state is reported as an explicit unsupported-version notice rather
 * than silently guessed at.
 */
import { ManagerBase } from "@jupyter-widgets/base-manager";
import { satisfies } from "semver";
import { MessageLoop } from "@lumino/messaging";
import { Widget } from "@lumino/widgets";
import type { WidgetModel, WidgetView } from "@jupyter-widgets/base";

/** Class instances that expose Lumino's attach point under either historical field name. */
type LuminoHost = { luminoWidget?: Widget; pWidget?: Widget };

function luminoWidgetOf(view: WidgetView): Widget | undefined {
  const host = view as unknown as LuminoHost;
  return host.luminoWidget ?? host.pWidget;
}

export class UnsupportedWidgetVersionError extends Error {}

export class MinimalWidgetManager extends ManagerBase {
  private readonly attachedViews = new Set<WidgetView>();
  private classLoadFailure: Error | undefined;

  /** ManagerBase turns class-load errors into error widgets; never report those as success. */
  assertClassesLoaded(): void {
    if (this.classLoadFailure !== undefined) {
      throw this.classLoadFailure;
    }
  }

  constructor() {
    super();
    window.addEventListener("resize", () => {
      for (const view of this.attachedViews) {
        const luminoWidget = luminoWidgetOf(view);
        if (luminoWidget) {
          MessageLoop.postMessage(luminoWidget, Widget.ResizeMessage.UnknownSize);
        }
      }
    });
  }

  async display_view(viewOrPromise: Promise<WidgetView> | WidgetView, el: HTMLElement): Promise<void> {
    const view = await viewOrPromise;
    const luminoWidget = luminoWidgetOf(view);
    if (!luminoWidget) {
      throw new Error("Widget view did not produce a Lumino widget to attach.");
    }
    Widget.attach(luminoWidget, el);
    this.attachedViews.add(view);
  }

  protected _get_comm_info(): Promise<Record<string, never>> {
    return Promise.resolve({});
  }

  protected _create_comm(): Promise<never> {
    // Saved widget state never has a live kernel comm behind it.
    return Promise.reject(new Error("No live kernel comm is available for saved widget state."));
  }

  /**
   * Resolve a class from one of the two bundled, standard widget modules
   * only, and only for the ipywidgets 8 major version. No `loader` fallback
   * is provided: any other module name always rejects.
   * `validateWidgetPayload` in `lib/interactive-output.ts` already screens
   * out non-standard modules before this is ever reached; this is defense
   * in depth, not the primary control.
   */
  protected async loadClass(
    className: string,
    moduleName: string,
    moduleVersion: string,
  ): Promise<typeof WidgetModel | typeof WidgetView> {
    try {
      return await this.resolveBundledClass(className, moduleName, moduleVersion);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.classLoadFailure ??= failure;
      throw failure;
    }
  }

  private async resolveBundledClass(
    className: string,
    moduleName: string,
    moduleVersion: string,
  ): Promise<typeof WidgetModel | typeof WidgetView> {
    if (moduleName !== "@jupyter-widgets/base" && moduleName !== "@jupyter-widgets/controls") {
      throw new Error(`Refusing to load non-standard widget module "${moduleName}".`);
    }
    if (!satisfies(moduleVersion, "^2.0.0", { includePrerelease: true })) {
      throw new UnsupportedWidgetVersionError(
        `Saved widget module "${moduleName}@${moduleVersion}" is not ipywidgets 8; only ipywidgets 8 saved state is supported.`,
      );
    }

    const widgetModule: Record<string, unknown> =
      moduleName === "@jupyter-widgets/base"
        ? ((await import("@jupyter-widgets/base")) as unknown as Record<string, unknown>)
        : ((await import("@jupyter-widgets/controls")) as unknown as Record<string, unknown>);

    if (moduleName === "@jupyter-widgets/controls") {
      await import("@jupyter-widgets/controls/css/widgets.css");
    }

    // `in`/bracket access alone would also resolve an inherited
    // `Object.prototype` member (e.g. a hostile `className` of
    // "constructor" or "toString"), so require the class to be the
    // module's own exported property before returning it.
    if (!Object.prototype.hasOwnProperty.call(widgetModule, className)) {
      throw new Error(`Class "${className}" was not found in module "${moduleName}".`);
    }
    const resolved = widgetModule[className];
    if (typeof resolved !== "function") {
      throw new Error(`Class "${className}" was not found in module "${moduleName}".`);
    }
    return resolved as typeof WidgetModel | typeof WidgetView;
  }
}
