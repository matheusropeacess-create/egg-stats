// Egg Stats – Interest Patch (compatível com <details class="matchCard">)
(function () {
  if (window.__EGG_INTEREST_PATCH__) return;
  window.__EGG_INTEREST_PATCH__ = true;

  function apply() {
    const cards = document.querySelectorAll("details.matchCard");

    cards.forEach(card => {
      try {
        // tenta extrair interestLevel do texto interno
        const text = card.innerText || "";

        let level = null;
        if (text.includes("MUITO INTERESSANTE")) level = "HIGH";
        else if (text.includes("INTERESSANTE")) level = "MEDIUM";
        else if (text.includes("IGNORAR")) level = "LOW";

        // fallback: usa emojis se existirem
        if (!level) {
          if (text.includes("🟢")) level = "HIGH";
          else if (text.includes("🟡")) level = "MEDIUM";
          else if (text.includes("🔴")) level = "LOW";
        }

        if (!level) return;

        // limpa estados antigos
        card.classList.remove("interest-high", "interest-medium", "interest-low");

        // aplica novo estado
        if (level === "HIGH") {
          card.classList.add("interest-high");
          card.open = true;
        }
        else if (level === "MEDIUM") {
          card.classList.add("interest-medium");
          card.open = true;
        }
        else if (level === "LOW") {
          card.classList.add("interest-low");
          card.open = false;
          card.style.opacity = "0.55";
        }
      } catch (e) {
        // silêncio total, nunca quebra o app
      }
    });
  }

  // roda ao carregar
  apply();

  // observa mudanças (quando filtros mudam)
  const obs = new MutationObserver(() => apply());
  obs.observe(document.body, { childList: true, subtree: true });
})();
