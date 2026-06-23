const finishButtons = [...document.querySelectorAll("[data-finish-type]")];
const rangeInputs = [...document.querySelectorAll('input[type="range"]')];
const customLabel = document.querySelector("#custom-label");
const dropZone = document.querySelector("#drop-zone");
const fileInput = document.querySelector("#file-input");
const folderInput = document.querySelector("#folder-input");

function selectFinishType(button) {
  for (const candidate of finishButtons) {
    const selected = candidate === button;
    candidate.classList.toggle("selected", selected);
    candidate.setAttribute("aria-checked", String(selected));
  }
  customLabel.textContent = button.querySelector("strong").textContent;
}

for (const button of finishButtons) {
  button.addEventListener("click", () => selectFinishType(button));
}

for (const input of rangeInputs) {
  input.addEventListener("input", () => {
    const output = document.querySelector(`output[for="${input.id}"]`);
    if (!output) return;
    const unit = output.dataset.unit ?? "";
    output.value = `${input.value}${unit}`;
    output.textContent = `${input.value}${unit}`;
    customLabel.textContent = "カスタム";
  });
}

document.querySelector("#choose-files").addEventListener("click", (event) => {
  event.stopPropagation();
  fileInput.click();
});

document.querySelector("#choose-folder").addEventListener("click", (event) => {
  event.stopPropagation();
  folderInput.click();
});

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});

for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("drag-over");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("drag-over");
  });
}
