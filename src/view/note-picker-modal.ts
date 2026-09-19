import { App, FuzzySuggestModal, TFile } from "obsidian";

/** Fuzzy-search picker over every Markdown note in the vault — the fallback
 *  when a "compose from note" command runs with no Markdown note active.
 *  `onCancel` fires if the picker is dismissed without choosing a note. */
export class NotePickerModal extends FuzzySuggestModal<TFile> {
  private chosen = false;

  constructor(
    app: App,
    private onChoose: (file: TFile) => void,
    private onCancel?: () => void,
  ) {
    super(app);
    this.setPlaceholder("Choose a note...");
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.chosen = true;
    this.onChoose(file);
  }

  onClose(): void {
    super.onClose();
    // Obsidian closes the modal around the moment it reports the chosen item,
    // and which comes first isn't something to rely on — so "dismissed" is
    // decided one tick later, after any choice has landed.
    setTimeout(() => {
      if (!this.chosen) this.onCancel?.();
    }, 0);
  }
}
