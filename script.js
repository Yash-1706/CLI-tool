const ctaButton = document.getElementById("heroCta");
const curriculumButton = document.getElementById("curriculumBtn");

if (ctaButton) {
  ctaButton.addEventListener("click", () => {
    ctaButton.textContent = "Session Reserved";
    ctaButton.disabled = true;
    ctaButton.style.opacity = "0.85";
  });
}

if (curriculumButton) {
  curriculumButton.addEventListener("click", () => {
    const footer = document.querySelector(".site-footer");
    if (footer) {
      footer.scrollIntoView({ behavior: "smooth" });
    }
  });
}
