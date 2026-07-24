export type Locale = "en" | "zh-CN";

/** Every translatable key lives here so both dictionaries and `t()` are type-checked. */
export const KEYS = [
  // Appearance
  "appearance.light",
  "appearance.dark",
  "appearance.system",
  // Settings menu
  "settings.appearance",
  "settings.hdIcons",
  "settings.data",
  "settings.language",
  "settings.export",
  "settings.import",
  // Language switcher
  "language.chinese",
  "language.english",
  // Toasts
  "toast.hdOn",
  "toast.hdDenied",
  "toast.hdOff",
  "toast.exportFail",
  "toast.importOk",
  "toast.importFail",
  "toast.folderCreated",
  "toast.filedIntoFolder",
  "toast.saveFail",
  "toast.deleted",
  "toast.folderDissolved",
  "toast.emptyFolderDeleted",
  "toast.linkUpdated",
  "toast.linkAdded",
  // Accessibility labels
  "a11y.add",
  "a11y.settings",
  "a11y.close",
  "a11y.toggleTheme",
  "a11y.changeWallpaper",
  "a11y.engine",
  "a11y.search",
  "a11y.deleteLink",
  "a11y.dissolveFolder",
  "a11y.page",
  // Link dialog
  "dialog.addTitle",
  "dialog.editTitle",
  "dialog.title",
  "dialog.url",
  "dialog.description",
  "dialog.location",
  "dialog.titlePh",
  "dialog.urlPh",
  "dialog.descPh",
  "dialog.desktop",
  "dialog.cancel",
  "dialog.save",
  // Greeting
  "greet.lateNight",
  "greet.morning",
  "greet.noon",
  "greet.afternoon",
  "greet.evening",
  // Search engines
  "engine.bing",
  "engine.google",
  "engine.baidu",
  "engine.github",
  // Search
  "search.placeholder",
  "search.empty",
  // Common
  "common.add",
  "common.untitled",
  "common.newFolder",
  // Desktop / edit
  "desktop.empty",
  "edit.hint",
  // Folder
  "folder.empty",
  // Confirm dialogs
  "confirm.deleteLink",
  "confirm.dissolveFolder",
] as const;

export type TranslationKey = (typeof KEYS)[number];

export type Dict = Record<TranslationKey, string>;

export type TParams = Record<string, string | number>;
