import type { Dict } from "../types";

/** English (default fallback). Every key from KEYS must be present. */
export const en: Dict = {
  "appearance.light": "Light",
  "appearance.dark": "Dark",
  "appearance.system": "Auto",

  "settings.appearance": "Appearance",
  "settings.hdIcons": "HD Icons",
  "settings.bookmarks": "Chrome Bookmarks",
  "settings.autoSync": "Auto-syncs when you open a new tab",
  "settings.syncNow": "Sync Now",
  "settings.lastSync": "Last synced",
  "settings.data": "Data",
  "settings.language": "Language",
  "settings.export": "Export Backup",
  "settings.import": "Import Backup",

  "language.chinese": "中文",
  "language.english": "English",

  "toast.hdOn": "HD icons enabled (refresh to apply)",
  "toast.hdDenied": "Permission not granted; HD icons unavailable",
  "toast.hdOff": "HD icons disabled",
  "toast.exportFail": "Export failed",
  "toast.importOk": "Imported",
  "toast.importFail": "Import failed: invalid file format",
  "toast.folderCreated": "Folder created",
  "toast.filedIntoFolder": "Added to folder",
  "toast.saveFail": "Save failed",
  "toast.deleted": "Deleted",
  "toast.folderDissolved": "Folder dissolved",
  "toast.emptyFolderDeleted": "Empty folder deleted",
  "toast.linkUpdated": "Link updated",
  "toast.linkAdded": "Link added",
  "toast.syncDone": "Bookmarks synced",
  "toast.syncNoChange": "Already up to date",
  "toast.syncFail": "Sync failed",

  "a11y.add": "Add",
  "a11y.settings": "Settings",
  "a11y.close": "Close",
  "a11y.toggleTheme": "Toggle theme",
  "a11y.changeWallpaper": "Change wallpaper",
  "a11y.engine": "Search engine",
  "a11y.search": "Search",
  "a11y.deleteLink": "Delete {title}",
  "a11y.dissolveFolder": "Dissolve folder {title}",
  "a11y.back": "Back to previous folder",
  "a11y.page": "Page {n} of {m}",

  "dialog.addTitle": "Add Link",
  "dialog.editTitle": "Edit Link",
  "dialog.title": "Title",
  "dialog.url": "URL",
  "dialog.description": "Description (optional)",
  "dialog.location": "Location",
  "dialog.titlePh": "e.g. GitHub",
  "dialog.urlPh": "https://example.com",
  "dialog.descPh": "One-line description of this site",
  "dialog.desktop": "Desktop",
  "dialog.cancel": "Cancel",
  "dialog.save": "Save",

  "greet.lateNight": "Late night",
  "greet.morning": "Good morning",
  "greet.noon": "Good noon",
  "greet.afternoon": "Good afternoon",
  "greet.evening": "Good evening",

  "engine.bing": "Bing",
  "engine.google": "Google",
  "engine.baidu": "Baidu",
  "engine.github": "GitHub",

  "search.placeholder": "Search bookmarks, or search the web",
  "search.empty": 'No matching bookmarks. Try searching the web for "{query}"',

  "common.add": "Add",
  "common.untitled": "Untitled",
  "common.newFolder": "New Folder",

  "desktop.empty": 'Your desktop is empty. Long-press an icon to edit, then tap "Add"',
  "edit.hint":
    "Drag to reorder · drag to screen edge to turn pages · drag together to make a folder · drag onto a folder to file · tap empty space or press Esc to finish",

  "folder.empty": "Empty folder",

  "confirm.deleteLink": 'Delete "{title}"?',
  "confirm.dissolveFolder":
    'Dissolve folder "{name}"? Its {n} links will move to the desktop.',
};
