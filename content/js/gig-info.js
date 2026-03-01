const GIGS_SHEET_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQM1FZ_1CDBMdL8jOOIrpHcQOaqag3lBE2o4yu5vLaDgGHE9btfRada2VJqMcqHyHaJe93qHOZ5uEsr/pub?gid=55127937&single=true&output=csv";

class GigInfo extends HTMLElement
{
    constructor()
    {
        super();
        this.attachShadow({ mode: "open" });
        this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }

        /* Basic structural lists styling */
        .gig-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        
        .gig-item {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          padding: 1rem 0;
          border-bottom: 1px solid #ccc;
        }
        
        .gig-item:last-child {
          border-bottom: none;
        }

        .gig-header-row {
          display: flex;
          justify-content: space-between;
          width: 100%;
          align-items: baseline;
        }
        
        .gig-item-blurb {
          font-size: 0.9em;
          opacity: 0.8;
          margin-top: 0.2rem;
        }

        .loading-text {
          color: #aaa;
          text-align: center;
        }
      </style>
      
      <div part="container">
        <!-- Next Gig Section -->
        <article part="next-container" id="next-container" style="display: none;">
          <p part="next-label">Next Live Performance</p>
          <h3 part="next-title" id="next-title"></h3>
          <p part="next-date" id="next-date"></p>
          <p part="next-location" id="next-location"></p>
          <p part="next-blurb" id="next-blurb"></p>
        </article>

        <!-- Upcoming Gigs Section -->
        <h3 part="section-title">Upcoming Shows</h3>
        <ul part="gig-list" class="gig-list" id="upcoming-gigs">
          <li part="gig-item" class="gig-item loading-text">Loading list...</li>
        </ul>

        <!-- Past Gigs Section -->
        <h3 part="section-title past-title">Past Gigs</h3>
        <ul part="gig-list past-list" class="gig-list" id="past-gigs">
          <li part="gig-item" class="gig-item loading-text">Loading list...</li>
        </ul>
      </div>
    `;
    }

    connectedCallback()
    {
        this.loadData();
    }

    async loadData()
    {
        // Dynamically load PapaParse if it's not already on the window
        if (typeof Papa === "undefined")
        {
            await this.loadPapaParse();
        }

        if (GIGS_SHEET_URL === "PLACEHOLDER_GOOGLE_SHEETS_CSV_URL")
        {
            console.warn("Google Sheets URL is missing in gig-info component.");
            this.showError("Calendar configuration missing.");
            return;
        }

        Papa.parse(GIGS_SHEET_URL, {
            download: true,
            header: true,
            complete: (results) =>
            {
                this.processGigs(results.data);
            },
            error: (err) =>
            {
                console.error("Error fetching gigs:", err);
                this.showError("Error loading gigs.");
            },
        });
    }

    loadPapaParse()
    {
        return new Promise((resolve, reject) =>
        {
            const script = document.createElement("script");
            script.src = "https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js";
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    showError(message)
    {
        const errorHtml = `<li part="gig-item" class="gig-item">${ message }</li>`;
        this.shadowRoot.getElementById("upcoming-gigs").innerHTML = errorHtml;
        this.shadowRoot.getElementById("past-gigs").innerHTML = errorHtml;
    }

    processGigs(data)
    {
        const gigs = data
            .map((row) =>
            {
                const locationParts = [row["Venue"], row["Address"]].filter(
                    (part) => part && part.trim() !== ""
                );
                const location = locationParts.join(", ");

                return {
                    title: row["Name"],
                    location: location,
                    date: row["Date"],
                    link: row["Link"],
                    blurb: row["Blurb"],
                };
            })
            .filter((gig) => gig.title && gig.date);

        this.renderConcerts(gigs);
    }

    renderConcerts(concerts)
    {
        const today = new Date();
        concerts.sort((a, b) => new Date(a.date) - new Date(b.date));

        const upcoming = concerts.filter((c) => new Date(c.date) >= today);
        const past = concerts.filter((c) => new Date(c.date) < today);

        // 1. Render Next Gig
        const nextGig = upcoming[0];
        const nextContainer = this.shadowRoot.getElementById("next-container");

        if (nextGig)
        {
            nextContainer.style.display = "block";

            const titleEl = this.shadowRoot.getElementById("next-title");
            if (nextGig.link)
            {
                titleEl.innerHTML = `<a href="${ nextGig.link }" target="_blank" part="link">${ nextGig.title }</a>`;
            } else
            {
                titleEl.textContent = nextGig.title;
            }

            const dateObj = new Date(nextGig.date);
            const dateStr = dateObj.toLocaleDateString(undefined, {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
            });

            this.shadowRoot.getElementById("next-date").innerHTML = `<time datetime="${ nextGig.date }">${ dateStr }</time>`;
            this.shadowRoot.getElementById("next-location").textContent = nextGig.location;
            this.shadowRoot.getElementById("next-blurb").textContent = nextGig.blurb || "";
        } else
        {
            nextContainer.style.display = "none";
        }

        // 2. Render Upcoming List
        const upcomingList = this.shadowRoot.getElementById("upcoming-gigs");
        upcomingList.innerHTML = upcoming
            .slice(1)
            .map((gig) => this.createGigListItem(gig))
            .join("") || `<li part="gig-item" class="gig-item">No more upcoming shows announced.</li>`;

        // 3. Render Past List
        const pastList = this.shadowRoot.getElementById("past-gigs");
        pastList.innerHTML = past
            .reverse()
            .map((gig) => this.createGigListItem(gig))
            .join("") || `<li part="gig-item" class="gig-item">No past shows found.</li>`;

        this.dispatchEvent(new CustomEvent('gigs-loaded', {
            bubbles: true,
            composed: true
        }));
    }

    createGigListItem(gig)
    {
        let content = `<span><span part="gig-title">${ gig.title }</span> @ <span part="gig-location">${ gig.location }</span></span>`;

        if (gig.link)
        {
            content = `<span><a href="${ gig.link }" target="_blank" part="link"><span part="gig-title">${ gig.title }</span></a> @ <span part="gig-location">${ gig.location }</span></span>`;
        }

        const blurbHtml = gig.blurb
            ? `<div part="gig-blurb" class="gig-item-blurb">${ gig.blurb }</div>`
            : "";

        const dateHtml = `<span part="gig-date"><time datetime="${ gig.date }">${ new Date(gig.date).toLocaleDateString() }</time></span>`;

        return `
      <li part="gig-item" class="gig-item">
        <div part="gig-header-row" class="gig-header-row">
            ${ content }
            ${ dateHtml }
        </div>
        ${ blurbHtml }
      </li>
    `;
    }
}

customElements.define("gig-info", GigInfo);
