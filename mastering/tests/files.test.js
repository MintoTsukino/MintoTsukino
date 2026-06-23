import assert from "node:assert/strict";
import test from "node:test";

import {
  collectDroppedFiles,
  naturalCompare,
  outputPathForTrack,
  resolveOutputPaths,
  sanitizeRelativePath,
} from "../js/files.js";

test("relative paths are sanitized without flattening safe folders", () => {
  assert.equal(
    sanitizeRelativePath("C:\\album\\..\\Disc 1\\bad:name?.wav"),
    "album/Disc 1/bad_name_.wav",
  );
  assert.equal(sanitizeRelativePath("/../../track.wav"), "track.wav");
});

test("natural sort places track2 before track10", () => {
  const paths = ["track10.wav", "track2.wav", "track1.wav"];
  paths.sort(naturalCompare);
  assert.deepEqual(paths, ["track1.wav", "track2.wav", "track10.wav"]);
});

test("output paths preserve folders and resolve collisions", () => {
  const tracks = [
    { path: "Disc 1/song.wav" },
    { path: "Disc 1/song.mp3" },
    { path: "Disc 2/song.wav" },
  ];
  assert.equal(outputPathForTrack(tracks[0]), "Disc 1/song_mastered.wav");
  assert.deepEqual(resolveOutputPaths(tracks), [
    "Disc 1/song_mastered.wav",
    "Disc 1/song_mastered_2.wav",
    "Disc 2/song_mastered.wav",
  ]);
});

test("folder drop walks nested entries and keeps the relative path", async () => {
  const audioFile = { name: "track01.wav" };
  const fileEntry = {
    isFile: true,
    isDirectory: false,
    file(callback) {
      callback(audioFile);
    },
  };
  let returned = false;
  const directoryEntry = {
    name: "Album",
    isFile: false,
    isDirectory: true,
    createReader() {
      return {
        readEntries(callback) {
          callback(returned ? [] : [fileEntry]);
          returned = true;
        },
      };
    },
  };
  const files = await collectDroppedFiles({
    items: [{ webkitGetAsEntry: () => directoryEntry }],
  });
  assert.equal(files.length, 1);
  assert.equal(files[0].relativePath, "Album/track01.wav");
});
