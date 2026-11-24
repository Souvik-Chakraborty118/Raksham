const API_BASE_URL = "https://raksham-api-zdv4.onrender.com";

let currentProfile = {
    user_id: null,
    name: "Raksham User",
    blood_group: "B+"
};
let activePreset = "helmet";
let customLogoDataUrl = null;
let qrCodeInstance = null;

// Built-in SVG logos as data URLs (zero CORS issues during PNG export)
const BUILTIN_LOGOS = {
    cross: "data:image/svg+xml;utf8," + encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="46" fill="#FF003C" stroke="#ffffff" stroke-width="6"/>
            <rect x="40" y="22" width="20" height="56" rx="5" fill="#ffffff"/>
            <rect x="22" y="40" width="56" height="20" rx="5" fill="#ffffff"/>
        </svg>`
    ),
    shield: "data:image/svg+xml;utf8," + encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            <path d="M50 6 L88 20 V50 C88 73 70 88 50 95 C30 88 12 73 12 50 V20 Z" fill="#18181b" stroke="#FF003C" stroke-width="6"/>
            <text x="50" y="64" font-family="Arial, sans-serif" font-weight="900" font-size="44" fill="#ffffff" text-anchor="middle">R</text>
        </svg>`
    )
};

function getScanUrl() {
    const id = currentProfile.user_id || "demo";
    return `https://raksham-pi.vercel.app/index.html?id=${encodeURIComponent(id)}`;
}

function getActiveLogo() {
    const choice = document.getElementById("logo-preset").value;
    if (choice === "none") return "";
    if (choice === "custom") return customLogoDataUrl || "";
    return BUILTIN_LOGOS[choice] || "";
}

function applyPreset(name, btnEl) {
    activePreset = name;
    document.querySelectorAll(".preset-btn").forEach((b) => b.classList.remove("active"));
    if (btnEl) btnEl.classList.add("active");

    if (name === "helmet") {
        document.getElementById("tag-headline").value = "🚨 SCAN IN EMERGENCY";
        document.getElementById("qr-fg").value = "#111111";
        document.getElementById("qr-bg").value = "#ffffff";
        document.getElementById("frame-accent").value = "#FF003C";
        document.getElementById("dot-style").value = "rounded";
        document.getElementById("corner-style").value = "extra-rounded";
    } else if (name === "lockscreen") {
        document.getElementById("tag-headline").value = "ICE • EMERGENCY MEDICAL ID";
        document.getElementById("qr-fg").value = "#18181b";
        document.getElementById("qr-bg").value = "#ffffff";
        document.getElementById("frame-accent").value = "#18181b";
        document.getElementById("dot-style").value = "classy-rounded";
        document.getElementById("corner-style").value = "extra-rounded";
    } else if (name === "wallet") {
        document.getElementById("tag-headline").value = "RAKSHAM MEDICAL TAG";
        document.getElementById("qr-fg").value = "#0f172a";
        document.getElementById("qr-bg").value = "#ffffff";
        document.getElementById("frame-accent").value = "#b91c1c";
        document.getElementById("dot-style").value = "square";
        document.getElementById("corner-style").value = "square";
    }
    renderQR();
}

function renderQR() {
    const fg = document.getElementById("qr-fg").value;
    const bg = document.getElementById("qr-bg").value;
    const accent = document.getElementById("frame-accent").value;
    const dotStyle = document.getElementById("dot-style").value;
    const cornerStyle = document.getElementById("corner-style").value;
    const headline = document.getElementById("tag-headline").value || "SCAN IN EMERGENCY";
    const showBlood = document.getElementById("show-blood").checked;
    const showName = document.getElementById("show-name").checked;
    const isDarkTheme = activePreset === "lockscreen";

    const card = document.getElementById("tag-card-preview");
    card.style.borderColor = accent;
    card.style.background = isDarkTheme ? "#111113" : "#ffffff";
    card.style.color = isDarkTheme ? "#f4f4f5" : "#18181b";

    const header = document.getElementById("preview-header");
    header.style.background = accent;
    header.innerText = headline;

    const bloodEl = document.getElementById("preview-blood");
    bloodEl.classList.toggle("hidden", !showBlood);
    bloodEl.style.background = isDarkTheme ? "#FF003C" : accent;
    bloodEl.innerText = `BLOOD: ${currentProfile.blood_group || "N/A"}`;

    const nameEl = document.getElementById("preview-name");
    nameEl.classList.toggle("hidden", !showName);
    nameEl.innerText = currentProfile.name || "";

    const options = {
        width: 230,
        height: 230,
        type: "canvas",
        data: getScanUrl(),
        margin: 6,
        qrOptions: { errorCorrectionLevel: "H" },
        dotsOptions: { color: fg, type: dotStyle },
        backgroundOptions: { color: bg },
        cornersSquareOptions: { color: fg, type: cornerStyle },
        cornersDotOptions: { color: accent, type: cornerStyle === "square" ? "square" : "dot" },
        image: getActiveLogo(),
        imageOptions: { hideBackgroundDots: true, imageSize: 0.34, margin: 4 }
    };

    const mount = document.getElementById("qr-canvas-mount");
    if (!qrCodeInstance) {
        qrCodeInstance = new QRCodeStyling(options);
        mount.innerHTML = "";
        qrCodeInstance.append(mount);
    } else {
        qrCodeInstance.update(options);
    }
}

function downloadRawQR() {
    if (!qrCodeInstance) return;
    qrCodeInstance.download({ name: "raksham-qr-only", extension: "png" });
}

async function downloadBrandedCard(mode) {
    if (!qrCodeInstance) return;
    const accent = document.getElementById("frame-accent").value;
    const headline = document.getElementById("tag-headline").value || "SCAN IN EMERGENCY";
    const showBlood = document.getElementById("show-blood").checked;
    const showName = document.getElementById("show-name").checked;
    const isDark = mode === "wallpaper" || activePreset === "lockscreen";

    const hiResQR = new QRCodeStyling({
        width: 560,
        height: 560,
        type: "canvas",
        data: getScanUrl(),
        margin: 14,
        qrOptions: { errorCorrectionLevel: "H" },
        dotsOptions: { color: document.getElementById("qr-fg").value, type: document.getElementById("dot-style").value },
        backgroundOptions: { color: document.getElementById("qr-bg").value },
        cornersSquareOptions: { color: document.getElementById("qr-fg").value, type: document.getElementById("corner-style").value },
        cornersDotOptions: { color: accent, type: document.getElementById("corner-style").value === "square" ? "square" : "dot" },
        image: getActiveLogo(),
        imageOptions: { hideBackgroundDots: true, imageSize: 0.34, margin: 8 }
    });

    const blob = await hiResQR.getRawData("png");
    const imgUrl = URL.createObjectURL(blob);
    const qrImg = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = imgUrl;
    });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    if (mode === "wallpaper") {
        canvas.width = 1080;
        canvas.height = 1920;
        ctx.fillStyle = "#0e0e11";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        drawCardOnCanvas(ctx, 140, 620, 800, 980, qrImg, headline, accent, true, showBlood, showName);
    } else {
        canvas.width = 800;
        canvas.height = 980;
        drawCardOnCanvas(ctx, 0, 0, 800, 980, qrImg, headline, accent, isDark, showBlood, showName);
    }

    URL.revokeObjectURL(imgUrl);

    const link = document.createElement("a");
    link.download = mode === "wallpaper" ? "raksham-lockscreen.png" : "raksham-emergency-tag.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
}

function drawCardOnCanvas(ctx, x, y, w, h, qrImg, headline, accent, isDark, showBlood, showName) {
    ctx.save();
    ctx.fillStyle = isDark ? "#16161a" : "#ffffff";
    ctx.fillRect(x, y, w, h);

    ctx.strokeStyle = accent;
    ctx.lineWidth = 14;
    ctx.strokeRect(x + 7, y + 7, w - 14, h - 14);

    ctx.fillStyle = accent;
    ctx.fillRect(x, y, w, 120);
    ctx.fillStyle = "#ffffff";
    ctx.font = "900 38px Poppins, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(headline, x + w / 2, y + 74);

    const qrSize = 540;
    const qrX = x + (w - qrSize) / 2;
    const qrY = y + 165;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(qrX - 18, qrY - 18, qrSize + 36, qrSize + 36);
    ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

    let textY = qrY + qrSize + 82;
    if (showBlood) {
        const bloodText = `BLOOD GROUP: ${currentProfile.blood_group || "N/A"}`;
        ctx.fillStyle = "#FF003C";
        ctx.fillRect(x + 190, textY - 42, w - 380, 58);
        ctx.fillStyle = "#ffffff";
        ctx.font = "900 30px Poppins, Arial, sans-serif";
        ctx.fillText(bloodText, x + w / 2, textY - 2);
        textY += 56;
    }
    if (showName && currentProfile.name) {
        ctx.fillStyle = isDark ? "#f4f4f5" : "#18181b";
        ctx.font = "700 30px Poppins, Arial, sans-serif";
        ctx.fillText(currentProfile.name, x + w / 2, textY);
    }

    ctx.fillStyle = isDark ? "#a1a1aa" : "#52525b";
    ctx.font = "600 22px Poppins, Arial, sans-serif";
    ctx.fillText("Scan with any camera • No app needed • RAKSHAM", x + w / 2, y + h - 38);
    ctx.restore();
}

function bindStudioEvents() {
    document.querySelectorAll(".preset-btn").forEach((btn) => {
        btn.addEventListener("click", () => applyPreset(btn.dataset.preset, btn));
    });

    ["tag-headline", "qr-fg", "qr-bg", "frame-accent"].forEach((id) => {
        document.getElementById(id).addEventListener("input", renderQR);
    });

    ["dot-style", "corner-style", "show-blood", "show-name"].forEach((id) => {
        document.getElementById(id).addEventListener("change", renderQR);
    });

    document.getElementById("logo-preset").addEventListener("change", (e) => {
        const isCustom = e.target.value === "custom";
        document.getElementById("custom-logo-file").classList.toggle("hidden", !isCustom);
        renderQR();
    });

    document.getElementById("custom-logo-file").addEventListener("change", (evt) => {
        const file = evt.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            customLogoDataUrl = e.target.result;
            renderQR();
        };
        reader.readAsDataURL(file);
    });

    document.getElementById("btn-dl-card").addEventListener("click", () => downloadBrandedCard("card"));
    document.getElementById("btn-dl-wallpaper").addEventListener("click", () => downloadBrandedCard("wallpaper"));
    document.getElementById("btn-dl-raw").addEventListener("click", downloadRawQR);
}

async function initStudio() {
    bindStudioEvents();

    const params = new URLSearchParams(window.location.search);
    const directId = params.get("id");
    const userEmail = localStorage.getItem("raksham_user_email");
    const statusEl = document.getElementById("studio-status");

    if (userEmail) {
        try {
            const res = await fetch(`${API_BASE_URL}/retrieve_profile_data`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: userEmail })
            });
            const data = await res.json();
            if (!data.error && data.user_data) {
                currentProfile = data.user_data;
                statusEl.innerText = `Linked to ${currentProfile.name}'s live Raksham emergency tag.`;
                renderQR();
                return;
            }
        } catch (e) {
            console.warn("Could not load profile:", e);
        }
    }

    if (directId) {
        currentProfile.user_id = directId;
        statusEl.innerText = "Loaded QR from direct link ID.";
    } else {
        statusEl.innerText = "Preview Mode — log in on profile.html to bind your personal QR ID.";
    }
    renderQR();
}

document.addEventListener("DOMContentLoaded", initStudio);
