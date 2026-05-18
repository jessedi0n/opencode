import { For, Show, onCleanup, onMount } from "solid-js"
import { createFileTabListSync } from "@/pages/session/file-tab-scroll"
import { createStore } from "solid-js/store"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tabs } from "@opencode-ai/ui/tabs"
import { useLanguage } from "@/context/language"
import { usePlatform, type DevServer } from "@/context/platform"

type WebviewEvent = Event & { url: string }
type WebviewFailEvent = Event & { errorCode: number; errorDescription: string }
type WebviewTitleEvent = Event & { title: string }
type BrowserWebview = HTMLElement & {
  src: string
  canGoBack: () => boolean
  canGoForward: () => boolean
  getURL: () => string
  goBack: () => void
  goForward: () => void
  isLoading: () => boolean
  reload: () => void
  reloadIgnoringCache?: () => void
  setZoomFactor?: (factor: number) => void
  stop: () => void
}
type BrowserTab = {
  id: string
  url: string
  title: string
}

const COMMON_PORTS = [3000, 5173, 4173, 8080, 8000, 9000, 5000, 3001, 5174, 4000, 4200, 1234, 4444, 4096]
const MAX_TABS = 12

export function BrowserPanel() {
  const platform = usePlatform()
  const language = useLanguage()
  const home = "about:blank"
  let host: HTMLDivElement | undefined
  let webview: BrowserWebview | undefined
  let scanning = false
  let webviewReady = false
  let nextTabID = 1

  const [store, setStore] = createStore({
    activeTabID: "tab-0",
    tabs: [{ id: "tab-0", url: home, title: "" }] as BrowserTab[],
    url: "",
    input: "",
    loading: false,
    canBack: false,
    canForward: false,
    pageTitle: "",
    zoom: 1,
    title: language.t("browser.panel.title") as string | undefined,
    message: language.t("browser.panel.empty") as string | undefined,
    detectedServers: [] as DevServer[],
    scanning: false,
  })

  const activeTab = () => store.tabs.find((tab) => tab.id === store.activeTabID) ?? store.tabs[0]

  const allowed = (value: string) => {
    if (value === home) return true
    if (!URL.canParse(value)) return false
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  }

  const normalize = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return home
    if (allowed(trimmed)) return trimmed
    if (URL.canParse(`https://${trimmed}`) && /^[^\s/]+\.[^\s]+/.test(trimmed)) return `https://${trimmed}`
    return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
  }

  const currentURL = () => webview?.getURL() || store.url || home
  const tabLabel = (tab: BrowserTab) => {
    if (tab.title) return tab.title
    if (tab.url === home) return language.t("browser.panel.title")
    if (!URL.canParse(tab.url)) return tab.url
    return new URL(tab.url).host
  }

  const setOverlay = (title?: string, message?: string) => {
    setStore({ title, message })
  }

  const syncActiveTab = (url: string, title?: string) => {
    setStore(
      "tabs",
      (tab) => tab.id === store.activeTabID,
      (tab) => ({
        ...tab,
        url,
        title: title ?? (url === home || url !== tab.url ? "" : tab.title),
      }),
    )
  }

  const update = () => {
    const url = currentURL()
    syncActiveTab(url)
    setOverlay(
      url === home ? language.t("browser.panel.title") : undefined,
      url === home ? language.t("browser.panel.empty") : undefined,
    )
    setStore({
      url,
      input: url === home ? "" : url,
      canBack: webview?.canGoBack() ?? false,
      canForward: webview?.canGoForward() ?? false,
    })
  }

  const scanPorts = async () => {
    if (!platform.scanDevServers || scanning) return
    scanning = true
    setStore("scanning", true)
    const servers = await platform.scanDevServers(COMMON_PORTS)
    if (currentURL() !== home) {
      scanning = false
      setStore("scanning", false)
      return
    }
    setStore({ detectedServers: servers, scanning: false })
    scanning = false
  }

  const serverActive = (server: DevServer) => {
    if (!URL.canParse(currentURL()) || !URL.canParse(server.url)) return false
    return new URL(currentURL()).origin === new URL(server.url).origin
  }

  const setZoom = (value: number) => {
    const zoom = Math.min(2, Math.max(0.5, Math.round(value * 100) / 100))
    setStore("zoom", zoom)
    if (!webviewReady) return
    try {
      webview?.setZoomFactor?.(zoom)
    } catch {
      webviewReady = false
    }
  }

  const forceReload = () => {
    if (!webview) return
    if (webview.reloadIgnoringCache) {
      webview.reloadIgnoringCache()
      return
    }
    webview.reload()
  }

  const setWebviewURL = (url: string) => {
    setStore({ url, input: url === home ? "" : url })
    if (webview) webview.src = url
  }

  const load = (value: string) => {
    const next = normalize(value)
    if (!allowed(next)) {
      setOverlay(language.t("browser.panel.unsupported.title"), language.t("browser.panel.unsupported.description"))
      return
    }

    setOverlay(
      next === home ? language.t("browser.panel.title") : undefined,
      next === home ? language.t("browser.panel.empty") : undefined,
    )
    syncActiveTab(next)
    setWebviewURL(next)
  }

  const addTab = (url = home) => {
    if (store.tabs.length >= MAX_TABS) return
    const id = `tab-${nextTabID++}`
    setStore("tabs", (tabs) => [...tabs, { id, url, title: "" }])
    setStore("activeTabID", id)
    setOverlay(
      url === home ? language.t("browser.panel.title") : undefined,
      url === home ? language.t("browser.panel.empty") : undefined,
    )
    setWebviewURL(url)
  }

  const selectTab = (id: string) => {
    const tab = store.tabs.find((item) => item.id === id)
    if (!tab) return
    setStore("activeTabID", id)
    setOverlay(
      tab.url === home ? language.t("browser.panel.title") : undefined,
      tab.url === home ? language.t("browser.panel.empty") : undefined,
    )
    setWebviewURL(tab.url)
  }

  const closeTab = (id: string) => {
    if (store.tabs.length === 1) {
      load(home)
      setStore("tabs", [{ id, url: home, title: "" }])
      return
    }

    const index = store.tabs.findIndex((tab) => tab.id === id)
    const nextTabs = store.tabs.filter((tab) => tab.id !== id)
    const nextActive = id === store.activeTabID ? nextTabs[Math.max(0, index - 1)] : activeTab()
    setStore("tabs", nextTabs)
    if (!nextActive) return
    setStore("activeTabID", nextActive.id)
    setOverlay(
      nextActive.url === home ? language.t("browser.panel.title") : undefined,
      nextActive.url === home ? language.t("browser.panel.empty") : undefined,
    )
    setWebviewURL(nextActive.url)
  }

  onMount(() => {
    if (!host) return

    const el = document.createElement("webview") as BrowserWebview
    el.setAttribute("partition", "persist:opencode-browser")
    el.setAttribute("webpreferences", "contextIsolation=yes,nodeIntegration=no,sandbox=yes")
    el.style.display = "flex"
    el.style.width = "100%"
    el.style.height = "100%"
    webview = el
    host.append(el)

    const ready = () => {
      webviewReady = true
      setZoom(store.zoom)
    }
    const start = () => setStore("loading", true)
    const stop = () => {
      setStore("loading", false)
      update()
    }
    const navigate = () => update()
    const willNavigate = (event: Event) => {
      const target = event as WebviewEvent
      if (allowed(target.url)) return
      event.preventDefault()
      setOverlay(language.t("browser.panel.unsupported.title"), language.t("browser.panel.unsupported.description"))
    }
    const newWindow = (event: Event) => {
      const target = event as WebviewEvent
      if (allowed(target.url) && target.url !== home) platform.openLink(target.url)
    }
    const failed = (event: Event) => {
      const target = event as WebviewFailEvent
      if (target.errorCode === -3) return
      setOverlay(language.t("browser.panel.failed.title"), target.errorDescription || language.t("browser.panel.failed.description"))
    }
    const titleChange = (event: Event) => {
      const target = event as WebviewTitleEvent
      if (currentURL() === home) return
      setStore("pageTitle", target.title)
      setStore("tabs", (tab) => tab.id === store.activeTabID, "title", target.title)
    }

    el.addEventListener("did-start-loading", start)
    el.addEventListener("dom-ready", ready)
    el.addEventListener("did-stop-loading", stop)
    el.addEventListener("did-navigate", navigate)
    el.addEventListener("did-navigate-in-page", navigate)
    el.addEventListener("will-navigate", willNavigate)
    el.addEventListener("new-window", newWindow)
    el.addEventListener("did-fail-load", failed)
    el.addEventListener("page-title-updated", titleChange)

    load(home)

    scanPorts()

    onCleanup(() => {
      el.removeEventListener("did-start-loading", start)
      el.removeEventListener("dom-ready", ready)
      el.removeEventListener("did-stop-loading", stop)
      el.removeEventListener("did-navigate", navigate)
      el.removeEventListener("did-navigate-in-page", navigate)
      el.removeEventListener("will-navigate", willNavigate)
      el.removeEventListener("new-window", newWindow)
      el.removeEventListener("did-fail-load", failed)
      el.removeEventListener("page-title-updated", titleChange)
      el.remove()
    })
  })

  return (
    <div class="size-full flex flex-col overflow-hidden">
      <Tabs value={store.activeTabID} onChange={selectTab} class="h-12 shrink-0">
        <Tabs.List
          ref={(el: HTMLDivElement) => {
            const stop = createFileTabListSync({ el, contextOpen: () => false })
            onCleanup(stop)
          }}
        >
          <For each={store.tabs}>
            {(tab) => (
              <Tabs.Trigger
                value={tab.id}
                closeButton={
                  <IconButton
                    icon="close-small"
                    variant="ghost"
                    class="h-5 w-5"
                    onClick={() => closeTab(tab.id)}
                    aria-label={language.t("common.close")}
                  />
                }
                hideCloseButton
                onMiddleClick={() => closeTab(tab.id)}
              >
                <div class="flex min-w-0 items-center gap-1.5">
                  <Show when={tab.url === home}>
                    <Icon name="globe" class="size-4 shrink-0" />
                  </Show>
                  <div class="min-w-0 truncate">{tabLabel(tab)}</div>
                </div>
              </Tabs.Trigger>
            )}
          </For>
          <div class="bg-background-stronger h-full shrink-0 sticky right-0 z-10 flex items-center justify-center pr-3">
            <IconButton
              icon="plus-small"
              variant="ghost"
              iconSize="large"
              class="!rounded-md"
              disabled={store.tabs.length >= MAX_TABS}
              onClick={() => addTab()}
              aria-label={language.t("browser.panel.newTab")}
            />
          </div>
        </Tabs.List>
      </Tabs>
      <div class="h-10 shrink-0 flex items-center gap-1 border-b border-border-weaker-base bg-background-stronger px-2">
        <IconButton
          icon="chevron-left"
          variant="ghost"
          class="h-6 w-6"
          disabled={!store.canBack}
          onClick={() => webview?.canGoBack() && webview.goBack()}
          aria-label={language.t("common.goBack")}
        />
        <IconButton
          icon="chevron-right"
          variant="ghost"
          class="h-6 w-6"
          disabled={!store.canForward}
          onClick={() => webview?.canGoForward() && webview.goForward()}
          aria-label={language.t("common.goForward")}
        />
        <IconButton
          icon={store.loading ? "close-small" : "refresh"}
          variant="ghost"
          class="h-6 w-6"
          onClick={() => {
            if (!webview) return
            if (webview.isLoading()) {
              webview.stop()
              return
            }
            webview.reload()
          }}
          aria-label={store.loading ? language.t("browser.panel.stop") : language.t("browser.panel.reload")}
        />
        <form
          class="min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault()
            load(store.input)
          }}
        >
          <input
            class="h-7 w-full min-w-0 rounded-md border border-border-weak-base bg-surface-panel px-2 text-12-regular text-text-strong outline-none placeholder:text-text-weaker focus:border-border-strong"
            value={store.input}
            placeholder={language.t("browser.panel.placeholder")}
            spellcheck={false}
            autocomplete="off"
            onInput={(event) => setStore("input", event.currentTarget.value)}
            aria-label={language.t("browser.panel.placeholder")}
          />
        </form>
        <DropdownMenu gutter={6} placement="bottom-end">
          <DropdownMenu.Trigger
            as={IconButton}
            icon="more-horizontal"
            variant="ghost"
            class="h-6 w-6"
            aria-label={language.t("browser.panel.menu")}
          />
          <DropdownMenu.Portal>
            <DropdownMenu.Content class="mt-1 min-w-56">
              <DropdownMenu.Item disabled={currentURL() === home} onSelect={forceReload}>
                <DropdownMenu.ItemLabel>{language.t("browser.panel.forceReload")}</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              <div class="flex items-center justify-between gap-3 px-3 py-2">
                <div class="text-13-regular text-text-strong">{language.t("browser.panel.zoom")}</div>
                <div class="ml-auto flex items-center gap-1">
                  <div class="flex h-7 items-center overflow-hidden rounded-md border border-border-weak-base bg-surface-panel">
                    <button
                      class="grid h-7 w-8 place-items-center text-text-weak hover:bg-surface-hover hover:text-text-strong"
                      onClick={() => setZoom(store.zoom - 0.1)}
                      aria-label={language.t("browser.panel.zoomOut")}
                    >
                      <Icon name="minus-small" />
                    </button>
                    <div class="min-w-14 border-x border-border-weak-base px-2 text-center text-13-regular text-text-strong">
                      {Math.round(store.zoom * 100)}%
                    </div>
                    <button
                      class="grid h-7 w-8 place-items-center text-text-weak hover:bg-surface-hover hover:text-text-strong"
                      onClick={() => setZoom(store.zoom + 0.1)}
                      aria-label={language.t("browser.panel.zoomIn")}
                    >
                      <Icon name="plus-small" />
                    </button>
                  </div>
                  <IconButton
                    icon="refresh"
                    variant="ghost"
                    class="h-6 w-6"
                    onClick={() => setZoom(1)}
                    aria-label={language.t("browser.panel.zoomReset")}
                  />
                </div>
              </div>
              <DropdownMenu.Separator />
              <DropdownMenu.Item onSelect={() => platform.clearBrowserCookies?.()}>
                <DropdownMenu.ItemLabel>{language.t("browser.panel.clearCookies")}</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => platform.clearBrowserCache?.()}>
                <DropdownMenu.ItemLabel>{language.t("browser.panel.clearCache")}</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </div>
      <div class="relative min-h-0 flex-1 bg-background-stronger">
        <div ref={host} class="size-full" />
        <Show when={store.title}>
          <div class="absolute inset-0 overflow-y-auto bg-background-stronger px-6 text-center">
            <div class="flex min-h-full flex-col items-center justify-center">
              <div class="w-full max-w-[520px]">
                <Show when={!store.scanning && store.detectedServers.length === 0}>
                  <div class="mx-auto max-w-72">
                    <div class="text-13-medium text-text-strong">{store.title}</div>
                    <Show when={store.message}>
                      <div class="mt-1 text-12-regular text-text-weak leading-relaxed">{store.message}</div>
                    </Show>
                  </div>
                </Show>
                <div
                  classList={{
                    "mt-3": !store.scanning && store.detectedServers.length === 0,
                  }}
                  class="min-h-[160px]"
                >
                  <Show when={store.scanning}>
                    <div class="text-12-regular text-text-weaker">{language.t("browser.panel.scanning")}</div>
                  </Show>
                  <Show when={!store.scanning && store.detectedServers.length === 0}>
                    <div class="text-12-regular text-text-weaker">{language.t("browser.panel.noServers")}</div>
                  </Show>
                  <Show when={store.detectedServers.length > 0}>
                    <div class="mt-1">
                      <div class="mb-2 text-11-medium text-text-weak uppercase tracking-wide">
                        {language.t("browser.panel.localServers")}
                      </div>
                      <div class="flex flex-col gap-2">
                        <For each={store.detectedServers}>
                          {(server) => (
                            <button
                              class="grid grid-cols-[72px_minmax(0,1fr)_16px] items-center gap-4 rounded-xl border border-border-weak-base bg-surface-panel px-3 py-3 text-left hover:bg-surface-hover hover:border-border-strong-base transition-colors"
                              onClick={() => load(server.url)}
                            >
                              <div class="grid h-10 w-[66px] place-items-center overflow-hidden rounded-lg border border-border-weak-base bg-surface-element shadow-sm">
                                <div class="flex h-8 w-[56px] flex-col justify-center gap-1 rounded-md bg-background-base px-1.5">
                                  <div class="h-1 rounded-full bg-border-weak-base" />
                                  <div class="h-1 w-2/3 rounded-full bg-border-strong-base" />
                                  <div class="truncate text-[6px] font-medium leading-none text-text-strong">
                                    {server.title}
                                  </div>
                                </div>
                              </div>
                              <div class="min-w-0">
                                <div class="truncate text-13-medium text-text-strong">{server.title}</div>
                                <div class="mt-0.5 truncate text-12-regular text-text-weaker">{server.url}</div>
                              </div>
                              <span
                                classList={{
                                  "bg-icon-success-base": serverActive(server),
                                  "bg-icon-disabled": !serverActive(server),
                                }}
                                class="size-2 rounded-full justify-self-center"
                              />
                            </button>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                </div>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </div>
  )
}
