import { App, FuzzySuggestModal, TFile } from "obsidian";

/** Fuzzy-search picker over every Markdown note in the vault — the fallback
 *  when a "compose from note" command runs with no Markdown note active. */
export class NotePickerModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private onChoose: (file: TFile) => void) {
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
    this.onChoose(file);
  }
}
