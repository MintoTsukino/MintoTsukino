import { copySettings } from "./finish-types.js";

export const appState = {
  tracks: [],
  selectedFinishType: "streaming",
  customSettings: false,
  settings: copySettings("streaming"),
  albumAnalysis: null,
  renderPlan: null,
  previewTrackId: null,
  preview: null,
  render: {
    active: false,
    cancelled: false,
    results: [],
    individualMode: false,
  },
};

export function resetAlbumState() {
  appState.albumAnalysis = null;
  appState.renderPlan = null;
  appState.preview = null;
  appState.render.results = [];
}
