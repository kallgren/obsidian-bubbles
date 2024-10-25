import {
	App,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	normalizePath,
} from "obsidian";

interface BubblesPluginSettings {
	bubbleFolder: string;
	archiveFolder: string;
}

const DEFAULT_SETTINGS: BubblesPluginSettings = {
	bubbleFolder: "plugins/bubbles",
	archiveFolder: "plugins/bubbles/archive",
};

export default class BubblesPlugin extends Plugin {
	settings: BubblesPluginSettings;
	private bubbleStatusBar: HTMLElement;

	async onload() {
		await this.loadSettings();

		this.addRibbonIcon("circle", "Create new bubble", (evt: MouseEvent) => {
			this.createBubble(true);
		});

		// Initialize status bar
		this.bubbleStatusBar = this.addStatusBarItem();
		this.updateBubbleCount();

		this.addCommand({
			id: "create-bubble",
			name: "Create bubble",
			callback: () => this.createBubble(),
		});

		this.addCommand({
			id: "open-oldest-bubble",
			name: "Open oldest bubble",
			callback: () => this.openBubbleByAge("oldest"),
		});

		this.addCommand({
			id: "open-most-recent-bubble",
			name: "Open most recent bubble",
			callback: () => this.openBubbleByAge("newest"),
		});

		this.addCommand({
			id: "next-bubble",
			name: "Go to next bubble",
			checkCallback: (checking: boolean) => {
				if (this.isActiveFileAnActiveBubble()) {
					if (!checking) {
						this.openAdjacentBubble("next");
					}

					return true;
				}
			},
		});

		this.addCommand({
			id: "previous-bubble",
			name: "Go to previous bubble",
			checkCallback: (checking: boolean) => {
				if (this.isActiveFileAnActiveBubble()) {
					if (!checking) {
						this.openAdjacentBubble("previous");
					}

					return true;
				}
			},
		});

		this.addCommand({
			id: "archive-current-bubble",
			name: "Archive current bubble",
			checkCallback: (checking: boolean) => {
				if (this.isActiveFileAnActiveBubble()) {
					if (!checking) {
						this.archiveCurrentBubble();
					}

					return true;
				}
			},
		});

		this.addCommand({
			id: "archive-current-bubble-go-next",
			name: "Archive current bubble and go to next",
			checkCallback: (checking: boolean) => {
				if (this.isActiveFileAnActiveBubble()) {
					if (!checking) {
						this.archiveAndOpenNextBubble();
					}

					return true;
				}
			},
		});

		// this.addCommand({
		// 	id: "open-bubbles-folder",
		// 	name: "Open bubbles folders",
		// 	callback: () => this.openBubblesFolder(),
		// });

		// this.addCommand({
		// 	id: "open-all-bubbles",
		// 	name: "Open all active bubbles in separate tabs",
		// 	callback: () => this.openAllBubbles(),
		// });

		// this.addCommand({
		// 	id: "close-all-bubbles",
		// 	name: "Closes all open bubbles (including archived)",
		// 	callback: () => this.closeAllBubbles(),
		// });

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new BubblesSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, "click", (evt: MouseEvent) => {
			console.log("click", evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(
			window.setInterval(() => console.log("setInterval"), 5 * 60 * 1000)
		);
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	isActiveBubble(file: TFile): boolean {
		const folderPath = normalizePath(this.settings.bubbleFolder);
		const archiveFolderPath = normalizePath(this.settings.archiveFolder);

		return (
			file.path.startsWith(folderPath) &&
			!file.path.startsWith(archiveFolderPath) &&
			file.extension === "md"
		);
	}

	// Get all bubbles excluding archived ones
	getActiveBubbles(): TFile[] {
		const files = this.app.vault.getFiles();
		return files.filter(this.isActiveBubble.bind(this));
	}

	// TODO: Can this be used in other places?
	isActiveFileAnActiveBubble(): boolean {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return false;

		return this.isActiveBubble(activeFile);
	}

	// Function to update the bubble count in the status bar
	async updateBubbleCount() {
		// Filter for non-archived bubbles in the main bubbles folder
		const files = this.app.vault.getFiles();
		const bubbleFiles = files.filter(this.isActiveBubble.bind(this));

		// Update status bar with the count
		const count = bubbleFiles.length;
		if (count) {
			const bubbleWord = count === 1 ? "bubble" : "bubbles";
			this.bubbleStatusBar.setText(`${bubbleFiles.length} ${bubbleWord}`);
		} else {
			this.bubbleStatusBar.setText("");
		}
	}

	async createBubble(newTab: boolean | undefined = false) {
		const now = new Date();
		const dateStr = now.toISOString().split("T")[0]; // Format: YYYY-MM-DD
		const timeStr = `${now.getHours()}${now.getMinutes()}${now.getSeconds()}`; // Format: HHMMSS
		const folderPath = normalizePath(this.settings.bubbleFolder);
		const filePrefix = `[Bubble] ${dateStr} ${timeStr}`;
		let fileName = `${filePrefix}.md`;
		let count = 1;

		// Increment file name if one already exists
		while (
			this.app.vault.getAbstractFileByPath(`${folderPath}/${fileName}`)
		) {
			fileName = `${filePrefix} (${count}).md`;
			count++;
		}

		const filePath = `${folderPath}/${fileName}`;
		const fileContent = "";

		try {
			// Ensure folder exists
			await this.app.vault.createFolder(folderPath).catch(() => {});

			// Create the new file
			const newFile = await this.app.vault.create(filePath, fileContent);
			// new Notice(`Created new bubble: ${fileName}`);
			this.updateBubbleCount();

			// Open the new file in the editor
			const leaf = this.app.workspace.getLeaf(newTab);
			await leaf.openFile(newFile);
		} catch (error) {
			console.error("Failed to create bubble:", error);
			new Notice(
				"Error creating bubble. Check the console for more details."
			);
		}
	}

	async getAdjacentBubble(
		direction: "previous" | "next"
	): Promise<TFile | null> {
		const bubbleFiles = this.getActiveBubbles();

		// If there are no bubbles, show a notice
		if (bubbleFiles.length === 0) {
			new Notice("Could not find any bubbles."); // TODO: throw error instead?
			return null;
		}

		// Sort files by creation date (oldest first)
		bubbleFiles.sort((a, b) => a.stat.ctime - b.stat.ctime);

		// Get the currently open file
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile || !bubbleFiles.includes(activeFile)) {
			new Notice("Currently not in an active bubble."); // TODO: throw error instead?
			return null;
		}

		// Find the index of the active file
		const currentIndex = bubbleFiles.findIndex(
			(file) => file === activeFile
		);

		// Determine the target index based on direction
		const targetIndex =
			direction === "previous" ? currentIndex - 1 : currentIndex + 1;

		// Check if the target index is valid
		if (targetIndex < 0 || targetIndex >= bubbleFiles.length) {
			if (direction === "previous") {
				new Notice("There's no bubble before this one."); // TODO: throw error and leave this for the calling function?
			} else {
				new Notice("There's no bubble after this one."); // TODO: throw error and leave this for the calling function?
			}
			return null;
		}

		// Get the target file (previous or next based on direction)
		const targetFile = bubbleFiles[targetIndex];

		return targetFile;
	}

	async openAdjacentBubble(direction: "previous" | "next") {
		const targetFile = await this.getAdjacentBubble(direction);

		// Open the target file in a new workspace leaf
		if (targetFile) {
			const leaf = this.app.workspace.getLeaf();
			await leaf.openFile(targetFile);
		}
	}

	async openBubbleByAge(age: "newest" | "oldest") {
		const bubbleFiles = this.getActiveBubbles();

		// If there are no files, create new bubble and show a notice
		if (bubbleFiles.length === 0) {
			this.createBubble();
			new Notice("New bubble created.");
			return;
		}

		// Sort files by creation date (newest first for newest, oldest first for oldest)
		bubbleFiles.sort((a, b) => a.stat.ctime - b.stat.ctime); // ctime is the creation time

		// Get the file based on age
		const targetFile =
			age === "newest"
				? bubbleFiles[bubbleFiles.length - 1]
				: bubbleFiles[0];

		// Check if the target file is already open in any of the leaves
		const openLeaf = this.app.workspace
			.getLeavesOfType("markdown")
			.find(
				(leaf) =>
					leaf.view instanceof MarkdownView &&
					leaf.view.file?.path === targetFile.path
			);

		if (openLeaf) {
			this.app.workspace.setActiveLeaf(openLeaf);
		} else {
			await this.app.workspace.getLeaf().openFile(targetFile);
		}
	}

	async archiveCurrentBubble() {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice("No active bubble to archive.");
			return false;
		}

		if (!this.isActiveFileAnActiveBubble()) {
			new Notice("Current note is not a bubble or is already archived.");
			return false;
		}

		const archiveFolderPath = normalizePath(this.settings.archiveFolder);
		const newFilePath = `${archiveFolderPath}/${activeFile.name}`;

		try {
			// Ensure archive folder exists
			await this.app.vault
				.createFolder(archiveFolderPath)
				.catch(() => {});

			// Move the file to the archive folder
			await this.app.fileManager.renameFile(activeFile, newFilePath);
			new Notice(`Archived ${activeFile.name} to ${archiveFolderPath}`);
			this.updateBubbleCount();

			return true; // Archive successful
		} catch (error) {
			console.error("Failed to archive bubble:", error);
			new Notice(
				"Error archiving bubble. Check the console for more details."
			);
			return false; // Archive failed
		}
	}

	async archiveAndOpenNextBubble() {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice("No active bubble to archive.");
			return;
		}

		const nextBubble = await this.getAdjacentBubble("next");
		const prevBubble = await this.getAdjacentBubble("previous");

		// Archive the current note first
		const archiveSuccess = await this.archiveCurrentBubble();
		if (!archiveSuccess) {
			// Notice already handled in archiveCurrentBubble()
			// new Notice("Failed to archive the current bubble.");
			return;
		}

		// Now that we have archived the current note, attempt to open the next or previous bubble
		const currentLeaf = this.app.workspace.getLeaf();

		if (nextBubble) {
			await currentLeaf.openFile(nextBubble);
		} else if (prevBubble) {
			await currentLeaf.openFile(prevBubble);
		} else {
			if (currentLeaf) {
				currentLeaf.detach();
			}
			// Notice already handled in getAdjacentBubble()
			// new Notice("There's no bubble after this one.");
		}
	}
}

class BubblesSettingTab extends PluginSettingTab {
	plugin: BubblesPlugin;

	constructor(app: App, plugin: BubblesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Folder")
			.setDesc("The folder where active bubbles are stored")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.bubbleFolder)
					.setValue(this.plugin.settings.bubbleFolder)
					.onChange(async (value) => {
						this.plugin.settings.bubbleFolder = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Archive folder")
			.setDesc("The folder where archived bubbles are stored")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.archiveFolder)
					.setValue(this.plugin.settings.archiveFolder)
					.onChange(async (value) => {
						this.plugin.settings.archiveFolder = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
