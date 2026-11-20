(function() {
    // Prevent double-injection in Vivaldi Mobile
    if (window.__noisetteAutomatorV3Loaded || document.getElementById('noisette-automator-root')) return;
    window.__noisetteAutomatorV3Loaded = true;

    // ==========================================
    // 1. CENTRAL ORDER DATA (FILTERED)
    // Excluded: Banana Bread, 90g Brioche, Danishes
    // ==========================================

    function dailyOrder({ muffins = 4, almond = 1, scrolls = 0 } = {}) {
        const order = [];

        if (scrolls > 0) {
            order.push({ search: "Cinnamon Scroll 6 pack", qty: scrolls });
        }

        const muffinList = (muffins === 4) ? [
            ['Large Muffin Raspberry', 1],
            ['Large Muffin Blueberry', 1],
            ['Large Muffin Molten Chocolate', 1],
            ['Large Muffin Apple Crumble', 1]
        ] : [
            ['Large Muffin Blueberry', 1],
            ['Large Muffin Molten Chocolate', 1]
        ];
        order.push({ search: "Large Muffin", items: muffinList });

        order.push({
            search: "Croissant",
            items: [
                ['Almond Croissant', almond],
                ['Croissant', 1]
            ]
        });

        return order;
    }

    const MONDAY_ORDER = [
        { search: "sourdough 1.7 kg sliced", qty: 3 },
        ...dailyOrder({ muffins: 2 })
    ];

    const TUESDAY_ORDER = dailyOrder({ scrolls: 1 });

    const WEDNESDAY_ORDER = [
        { search: "sourdough 1.7 kg sliced", qty: 2 },
        ...dailyOrder({ muffins: 2, scrolls: 1 })
    ];

    const THURSDAY_ORDER = dailyOrder({ almond: 2 });

    const FRIDAY_ORDER = dailyOrder({ almond: 2 });

    const ORDER_SCHEDULE = [
        ["Monday", MONDAY_ORDER],
        ["Tuesday", TUESDAY_ORDER],
        ["Wednesday", WEDNESDAY_ORDER],
        ["Thursday", THURSDAY_ORDER],
        ["Friday", FRIDAY_ORDER]
    ];

    // Known Noisette Item Codes from your DOM blueprint & screenshot for 100% instant accuracy
    const KNOWN_ITEM_CODES = {
        "sourdough 1.7 kg sliced": "10342",
        "sourdough 1.7kg sliced": "10342",
        "large muffin blueberry": "10316",
        "blueberry large muffin": "10316",
        "large muffin raspberry": "10317",
        "raspberry large muffin": "10317",
        "large muffin molten chocolate": "10687",
        "molten chocolate large muffin": "10687",
        "large muffin apple crumble": "10319",
        "apple crumble large muffin": "10319"
    };

    function calculateCartTotal(orderList) {
        let total = 0;
        for (const item of orderList) {
            if (item.items) {
                total += item.items.reduce((sum, [_, qty]) => sum + qty, 0);
            } else {
                total += (item.qty || 1);
            }
        }
        return total;
    }

    // ==========================================
    // 2. LIGHTWEIGHT DOM HELPERS (NO TIMERS!)
    // ==========================================

    const sleep = (ms) => new Promise(res => setTimeout(res, ms));
    const randomBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

    function getLiveCartCount() {
        const els = document.querySelectorAll('span.cart-total, .basket-widget-container .cart-total');
        for (const el of els) {
            const num = parseInt(el.textContent.trim(), 10);
            if (!isNaN(num)) return num;
        }
        return 0;
    }

    function getSelectedDeliveryDate() {
        const dp = document.querySelector('input#date-picker-date');
        if (dp && dp.value) return dp.value.trim();
        return 'Check Header';
    }

    // Normalizes strings so "1.7kg" and "1.7 kg" or "6-pack" and "6 pack" match identically
    function normalizeText(str) {
        return (str || '')
            .toLowerCase()
            .replace(/(\d+(?:\.\d+)?)\s*(kg|g|gr|ml|l|pack|pk|pcs)\b/g, '$1$2') // fuse "1.7 kg" -> "1.7kg"
            .replace(/[^a-z0-9.]+/g, ' ')
            .trim();
    }

    function findProductListingCard(targetProductName) {
        const cards = Array.from(document.querySelectorAll('ul#listing-ul > li.item, li.item[data-itemno]'));
        if (cards.length === 0) return null;

        const rawKey = targetProductName.toLowerCase().trim();
        const knownCode = KNOWN_ITEM_CODES[rawKey];

        // 1. Instant match by Noisette Item Code (data-itemno or span.item-code) if known
        if (knownCode) {
            const codeMatch = cards.find(c => 
                c.getAttribute('data-itemno') === knownCode ||
                (c.querySelector('span.item-code')?.textContent.trim() === knownCode)
            );
            if (codeMatch) return codeMatch;
        }

        const normTarget = normalizeText(targetProductName);
        const targetTokens = normTarget.split(/\s+/).filter(Boolean);

        // Words that must NOT appear unless requested (prevents picking Almond Croissant when looking for plain Croissant, or 750gr when looking for 1.7kg)
        const negativeKeywords = ['almond', 'mini', 'chocolate', 'pain', 'ham', 'cheese', 'vegan', 'gluten', 'raw', 'unbaked', '750', 'tin'];

        let bestCard = null;
        let bestScore = -999;

        for (const card of cards) {
            const titleEl = card.querySelector('h2.product-name a, h2.product-name, a.product-image');
            const rawTitle = titleEl ? (titleEl.getAttribute('title') || titleEl.textContent || '') : card.textContent;
            const normTitle = normalizeText(rawTitle);

            if (!normTitle) continue;

            // Exact normalized match
            if (normTitle === normTarget) {
                return card;
            }

            // Check if all target tokens exist in normalized title (or fused string)
            const fusedTitle = normTitle.replace(/\s+/g, '');
            const allTokensPresent = targetTokens.every(token => 
                normTitle.includes(token) || fusedTitle.includes(token)
            );
            if (!allTokensPresent) continue;

            // Check negative keywords
            const titleWords = normTitle.split(/\s+/);
            let penalty = 0;
            for (const neg of negativeKeywords) {
                if (!normTarget.includes(neg) && titleWords.includes(neg)) {
                    penalty += 50;
                }
            }

            const lengthDiff = Math.abs(titleWords.length - targetTokens.length);
            const score = 100 - lengthDiff - penalty;

            if (score > bestScore) {
                bestScore = score;
                bestCard = card;
            }
        }

        return bestCard;
    }

    // Navigate directly without triggering the heavy mobile AJAX flyout keyboard
    async function executeSearchNavigation(searchTerm, updateStatus) {
        updateStatus(`Searching "${searchTerm}"...`);
        await sleep(randomBetween(1200, 2000));
        const targetUrl = `https://connect.noisette.com.au/product_search/?q=${encodeURIComponent(searchTerm)}`;
        window.location.assign(targetUrl);
    }

    async function navigateToCart(updateStatus) {
        updateStatus(`Day complete! Opening Cart...`);
        await sleep(randomBetween(1200, 2000));
        window.location.assign('https://connect.noisette.com.au/cart');
    }

    // ==========================================
    // 3. PERSISTENT MULTI-PAGE AUTOMATION ENGINE
    // ==========================================

    class NoisetteAutomatorApp {
        constructor() {
            this.steps = ORDER_SCHEDULE.map(([dayName, orderList]) => [
                dayName,
                orderList,
                calculateCartTotal(orderList)
            ]);

            this.state = {
                currentStepIdx: 0,
                awaitingVerification: false,
                lastExpectedCart: 0,
                isRunning: false,
                searchQueue: [],
                currentSearchGroup: null,
                isMinimized: false
            };

            this.aborted = false;
            this.init();
        }

        async init() {
            await this.loadState();
            this.injectStyles();
            this.buildUI();
            this.renderState();

            if (this.state.isRunning && !this.aborted) {
                // Let Vivaldi Mobile finish layout rendering before resuming
                setTimeout(() => this.resumeAutomationLoop(), 900);
            }
        }

        async loadState() {
            try {
                const res = await chrome.storage.local.get(['noisetteStateV3']);
                if (res && res.noisetteStateV3) {
                    this.state = { ...this.state, ...res.noisetteStateV3 };
                }
            } catch (e) {}
        }

        async saveState(patch = {}) {
            this.state = { ...this.state, ...patch };
            try {
                await chrome.storage.local.set({ noisetteStateV3: this.state });
            } catch (e) {}
        }

        async startDayOrder(dayIdx) {
            const [dayName, orderList, expectedCart] = this.steps[dayIdx];
            this.aborted = false;

            const queue = JSON.parse(JSON.stringify(orderList));
            const firstGroup = queue.shift();

            await this.saveState({
                isRunning: true,
                searchQueue: queue,
                currentSearchGroup: firstGroup,
                lastExpectedCart: expectedCart
            });

            this.setControlsEnabled(false);
            this.actionBtn.textContent = `Running ${dayName}...`;
            await executeSearchNavigation(firstGroup.search, (msg) => this.updateLiveStatus(msg));
        }

        async resumeAutomationLoop() {
            if (this.aborted || !this.state.isRunning) return;

            this.setControlsEnabled(false);
            const [dayName] = this.steps[this.state.currentStepIdx] || ["Order"];
            this.actionBtn.textContent = `Running ${dayName}...`;
            this.refreshHeaderBadges();

            try {
                const group = this.state.currentSearchGroup;

                if (group) {
                    if (!window.location.pathname.includes('/product_search')) {
                        await executeSearchNavigation(group.search, (msg) => this.updateLiveStatus(msg));
                        return;
                    }

                    this.updateLiveStatus(`Looking for "${group.search}"...`);

                    // Poll gently for up to 5 seconds in case mobile network is still rendering ul#listing-ul
                    let listingsReady = false;
                    for (let i = 0; i < 5; i++) {
                        if (document.querySelectorAll('ul#listing-ul > li.item, li.item[data-itemno]').length > 0) {
                            listingsReady = true;
                            break;
                        }
                        await sleep(800);
                    }

                    await sleep(randomBetween(800, 1400));

                    const productsToAdd = group.items
                        ? group.items
                        : [[group.search, group.qty || 1]];

                    for (const [productName, qty] of productsToAdd) {
                        if (this.aborted) throw new Error("Stopped by user.");

                        const card = findProductListingCard(productName);
                        if (!card) {
                            throw new Error(`Could not find product "${productName}" on this page.`);
                        }

                        // Lightweight instant scroll (avoids Vivaldi smooth-scroll crash)
                        try {
                            card.scrollIntoView({ behavior: 'instant', block: 'center' });
                        } catch (_) {
                            card.scrollIntoView();
                        }
                        await sleep(randomBetween(400, 700));

                        const addBtn = card.querySelector('button.add-cart-button, button.btn-cart');
                        if (!addBtn) {
                            // Check if item says "Next available delivery date"
                            const cardTxt = card.innerText || '';
                            if (cardTxt.toLowerCase().includes('next available delivery date')) {
                                throw new Error(`"${productName}" is unavailable for the selected delivery date!`);
                            }
                            throw new Error(`Found "${productName}", but "Add to Cart" button is missing.`);
                        }

                        // Click Add to Cart `qty` times with gentle server pacing
                        for (let c = 0; c < qty; c++) {
                            if (this.aborted) throw new Error("Stopped by user.");

                            const prevCartCount = getLiveCartCount();
                            this.updateLiveStatus(`Adding ${productName} (${c + 1}/${qty})...`);

                            addBtn.style.outline = '3px solid #51cf66';
                            addBtn.click();

                            // Wait for CommerceBuild AJAX cart counter to increment (up to 4s)
                            let waited = 0;
                            while (waited < 4000) {
                                await sleep(500);
                                waited += 500;
                                const newCount = getLiveCartCount();
                                if (newCount > prevCartCount) {
                                    this.refreshHeaderBadges();
                                    break;
                                }
                            }

                            // Server-friendly pause between clicks
                            await sleep(randomBetween(1200, 2000));
                            addBtn.style.outline = '';
                        }
                    }
                }

                // Proceed directly to next search (no Home screen detour)
                if (this.state.searchQueue.length > 0) {
                    const nextQueue = [...this.state.searchQueue];
                    const nextGroup = nextQueue.shift();

                    await this.saveState({
                        searchQueue: nextQueue,
                        currentSearchGroup: nextGroup
                    });

                    await executeSearchNavigation(nextGroup.search, (msg) => this.updateLiveStatus(msg));
                    return;
                }

                // All items for the day added!
                const finishedIdx = this.state.currentStepIdx;
                const finishedExpectedCart = this.steps[finishedIdx][2];

                await this.saveState({
                    isRunning: false,
                    currentSearchGroup: null,
                    searchQueue: [],
                    currentStepIdx: finishedIdx + 1,
                    awaitingVerification: true,
                    lastExpectedCart: finishedExpectedCart
                });

                await navigateToCart((msg) => this.updateLiveStatus(msg));

            } catch (err) {
                await this.saveState({ isRunning: false });
                this.statusBar.style.display = 'block';
                this.statusBar.style.color = '#ff6b6b';
                this.statusBar.textContent = `❌ ${err.message}`;
                this.setControlsEnabled(true);
                this.resetButtonText();
            }
        }

        // ==========================================
        // 4. MOBILE-FRIENDLY FLOATING GUI
        // ==========================================

        injectStyles() {
            const style = document.createElement('style');
            style.textContent = `
                #noisette-automator-root {
                    position: fixed;
                    bottom: 12px;
                    left: 12px;
                    width: 295px;
                    max-width: calc(100vw - 24px);
                    background-color: #1e1e1e;
                    color: #e0e0e0;
                    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
                    font-size: 13px;
                    border-radius: 10px;
                    border: 1px solid #444;
                    z-index: 2147483646;
                    user-select: none;
                }
                .na-header {
                    background-color: #292929;
                    padding: 9px 12px;
                    font-weight: bold;
                    font-size: 13px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 1px solid #3a3a3a;
                    border-radius: 10px 10px 0 0;
                    white-space: nowrap;
                }
                .na-header-btns {
                    display: flex;
                    gap: 6px;
                    align-items: center;
                }
                .na-header-btns span {
                    cursor: pointer;
                    color: #ccc;
                    font-size: 11.5px;
                    padding: 3px 6px;
                    background: #383838;
                    border-radius: 4px;
                }
                .na-body {
                    padding: 14px;
                    display: flex;
                    flex-direction: column;
                    gap: 11px;
                }
                .na-meta-pill {
                    font-size: 11.5px;
                    background: #262626;
                    padding: 6px 10px;
                    border-radius: 5px;
                    color: #a1a1aa;
                    display: flex;
                    justify-content: space-between;
                }
                .na-meta-pill strong { color: #fff; }
                .na-info {
                    font-size: 13px;
                    line-height: 1.4;
                    white-space: pre-line;
                }
                .na-status {
                    font-size: 12px;
                    color: #61afef;
                    background: #141414;
                    padding: 8px 10px;
                    border-radius: 5px;
                    display: none;
                    line-height: 1.35;
                }
                .na-checkbox-group {
                    display: none;
                    flex-direction: column;
                    gap: 8px;
                    background: #262626;
                    padding: 9px 11px;
                    border-radius: 6px;
                }
                .na-checkbox-label {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    cursor: pointer;
                    font-size: 12.5px;
                    margin: 0;
                }
                .na-checkbox-label input {
                    width: 16px;
                    height: 16px;
                    margin: 0;
                }
                .na-btn-row {
                    display: flex;
                    gap: 8px;
                }
                .na-btn {
                    flex: 1;
                    background-color: #007acc;
                    color: white;
                    border: none;
                    padding: 10px;
                    border-radius: 6px;
                    font-weight: bold;
                    font-size: 13px;
                    cursor: pointer;
                }
                .na-btn:disabled {
                    background-color: #444;
                    color: #888;
                }
                .na-btn-skip {
                    background-color: #555;
                    flex: 0.45;
                }
            `;
            document.head.appendChild(style);
        }

        refreshHeaderBadges() {
            if (this.liveDateEl) this.liveDateEl.textContent = getSelectedDeliveryDate();
            if (this.liveCartEl) this.liveCartEl.textContent = getLiveCartCount();
        }

        buildUI() {
            this.root = document.createElement('div');
            this.root.id = 'noisette-automator-root';

            this.root.innerHTML = `
                <div class="na-header">
                    <span>🥐 Noisette v3</span>
                    <div class="na-header-btns">
                        <span id="na-stop-btn">⏹ Stop</span>
                        <span id="na-reset-btn">↺ Reset</span>
                        <span id="na-min-btn">_</span>
                    </div>
                </div>
                <div class="na-body" id="na-body-content">
                    <div class="na-meta-pill">
                        <span>📅 <strong id="na-live-date">${getSelectedDeliveryDate()}</strong></span>
                        <span>🛒 Cart: <strong id="na-live-cart">${getLiveCartCount()}</strong></span>
                    </div>
                    <div class="na-info" id="na-info-label"></div>
                    <div class="na-status" id="na-status-bar"></div>
                    <div class="na-checkbox-group" id="na-cb-group">
                        <label class="na-checkbox-label">
                            <input type="checkbox" id="na-cb-day">
                            <span id="na-cb-day-text">Is Correct Day Chosen?</span>
                        </label>
                        <label class="na-checkbox-label">
                            <input type="checkbox" id="na-cb-cart">
                            <span id="na-cb-cart-text">Is Cart Amount Correct?</span>
                        </label>
                    </div>
                    <div class="na-btn-row">
                        <button class="na-btn" id="na-action-btn">Run Monday</button>
                        <button class="na-btn na-btn-skip" id="na-skip-btn">Skip</button>
                    </div>
                </div>
            `;

            document.body.appendChild(this.root);

            this.infoLabel = this.root.querySelector('#na-info-label');
            this.statusBar = this.root.querySelector('#na-status-bar');
            this.cbGroup = this.root.querySelector('#na-cb-group');
            this.cbDay = this.root.querySelector('#na-cb-day');
            this.cbCart = this.root.querySelector('#na-cb-cart');
            this.cbCartText = this.root.querySelector('#na-cb-cart-text');
            this.actionBtn = this.root.querySelector('#na-action-btn');
            this.skipBtn = this.root.querySelector('#na-skip-btn');
            this.bodyContent = this.root.querySelector('#na-body-content');
            this.liveDateEl = this.root.querySelector('#na-live-date');
            this.liveCartEl = this.root.querySelector('#na-live-cart');

            this.cbDay.addEventListener('change', () => this.resetButtonText());
            this.cbCart.addEventListener('change', () => this.resetButtonText());
            this.actionBtn.addEventListener('click', () => this.handleAction());
            this.skipBtn.addEventListener('click', () => this.handleSkip());

            this.root.querySelector('#na-min-btn').addEventListener('click', () => {
                const nextMin = !this.state.isMinimized;
                this.saveState({ isMinimized: nextMin });
                this.bodyContent.style.display = nextMin ? 'none' : 'flex';
            });

            this.root.querySelector('#na-stop-btn').addEventListener('click', async () => {
                this.aborted = true;
                await this.saveState({ isRunning: false, searchQueue: [], currentSearchGroup: null });
                this.statusBar.style.display = 'block';
                this.statusBar.style.color = '#ffa94d';
                this.statusBar.textContent = '⏹ Stopped by user.';
                this.setControlsEnabled(true);
                this.resetButtonText();
            });

            this.root.querySelector('#na-reset-btn').addEventListener('click', async () => {
                this.aborted = true;
                await this.saveState({
                    currentStepIdx: 0,
                    awaitingVerification: false,
                    lastExpectedCart: 0,
                    isRunning: false,
                    searchQueue: [],
                    currentSearchGroup: null
                });
                this.statusBar.style.display = 'none';
                this.setControlsEnabled(true);
                this.renderState();
            });
        }

        renderState() {
            this.refreshHeaderBadges();
            this.bodyContent.style.display = this.state.isMinimized ? 'none' : 'flex';

            if (this.state.currentStepIdx >= this.steps.length) {
                this.cbGroup.style.display = 'flex';
                this.cbDay.checked = false;
                this.cbCart.checked = false;
                this.cbCartText.textContent = `Is Cart Amount ${this.state.lastExpectedCart}?`;
                this.infoLabel.textContent = "✅ Friday Done! Proceed to order if everything is correct.\n\n🎉 All days have been completed!";
                this.actionBtn.textContent = "Reset to Monday";
                this.skipBtn.style.display = 'none';
                return;
            }

            this.skipBtn.style.display = 'inline-block';
            const nextDay = this.steps[this.state.currentStepIdx][0];

            if (!this.state.awaitingVerification && this.state.currentStepIdx === 0) {
                this.infoLabel.textContent = "Click once you have opened connect noisette & selected Monday.";
                this.cbGroup.style.display = 'none';
                this.actionBtn.textContent = "Run Monday";
            } else {
                const prevDay = this.state.currentStepIdx > 0 ? this.steps[this.state.currentStepIdx - 1][0] : "Day";
                this.cbGroup.style.display = 'flex';
                this.cbDay.checked = false;
                this.cbCart.checked = false;
                this.cbCartText.textContent = `Is Cart Amount ${this.state.lastExpectedCart}?`;
                this.infoLabel.textContent = `✅ ${prevDay} Done! Proceed to order if everything is correct.\n\nClick below when you have selected ${nextDay}.`;
                this.actionBtn.textContent = `Run ${nextDay}`;
            }
        }

        resetButtonText() {
            if (this.state.currentStepIdx < this.steps.length) {
                this.actionBtn.textContent = `Run ${this.steps[this.state.currentStepIdx][0]}`;
            } else {
                this.actionBtn.textContent = "Reset to Monday";
            }
        }

        setControlsEnabled(enabled) {
            this.actionBtn.disabled = !enabled;
            this.skipBtn.disabled = !enabled;
            this.cbDay.disabled = !enabled;
            this.cbCart.disabled = !enabled;
        }

        updateLiveStatus(msg) {
            this.statusBar.style.display = 'block';
            this.statusBar.style.color = '#61afef';
            this.statusBar.textContent = `⏳ ${msg}`;
        }

        async handleAction() {
            if (this.state.currentStepIdx >= this.steps.length) {
                await this.saveState({
                    currentStepIdx: 0,
                    awaitingVerification: false,
                    lastExpectedCart: 0,
                    isRunning: false,
                    searchQueue: [],
                    currentSearchGroup: null
                });
                this.renderState();
                return;
            }

            if (this.cbGroup.style.display !== 'none') {
                if (!this.cbDay.checked || !this.cbCart.checked) {
                    this.actionBtn.textContent = "⚠ Check both boxes!";
                    return;
                }
            }

            await this.startDayOrder(this.state.currentStepIdx);
        }

        async handleSkip() {
            if (this.state.currentStepIdx >= this.steps.length) return;
            const skippedCartAmt = this.steps[this.state.currentStepIdx][2];

            await this.saveState({
                currentStepIdx: this.state.currentStepIdx + 1,
                awaitingVerification: true,
                lastExpectedCart: skippedCartAmt,
                isRunning: false,
                searchQueue: [],
                currentSearchGroup: null
            });
            this.renderState();
        }
    }

    new NoisetteAutomatorApp();
})();