
class GigInfo extends HTMLElement
{
    constructor()
    {
        super();
        this.innerHTML = `
      <div class="gig-container">
        <!-- Next Gig Section -->
        <article id="next-container" style="display: none;">
          <p class="next-label">Next Live Performance</p>
          <h3 id="next-title"></h3>
          <p id="next-date"></p>
          <p id="next-location"></p>
          <p id="next-blurb"></p>
        </article>
      
        <!-- Upcoming Gigs Section -->
        <h3 class="section-title">Upcoming Shows</h3>
        <ul class="gig-list" id="upcoming-gigs">
          <li class="gig-item loading-text">Loading list...</li>
        </ul>
      
        <!-- Past Gigs Section -->
        <details class="past-details">
          <summary class="section-title past-title">Past Gigs</summary>
          <ul class="gig-list past-list" id="past-gigs">
            <li class="gig-item loading-text">Loading list...</li>
          </ul>
        </details>
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

        const sourcesAttr = this.getAttribute("sources");
        if (!sourcesAttr)
        {
            console.warn("No 'sources' attribute provided to gig-info component.");
            this.showError("Calendar configuration missing.");
            return;
        }

        const sourceUrls = sourcesAttr.split(",").map(url => url.trim()).filter(url => url);
        if (sourceUrls.length === 0)
        {
            this.showError("Calendar configuration missing.");
            return;
        }

        try
        {
            const fetchPromises = sourceUrls.map(url => this.fetchCsv(url));
            const resultsArray = await Promise.all(fetchPromises);

            // Combine all parsed rows from all spreadsheets
            let combinedData = [];
            resultsArray.forEach(dataset =>
            {
                combinedData = combinedData.concat(dataset);
            });

            this.processGigs(combinedData);
        } catch (err)
        {
            console.error("Error fetching gigs:", err);
            this.showError("Error loading gigs.");
        }
    }

    fetchCsv(url)
    {
        return new Promise((resolve, reject) =>
        {
            Papa.parse(url, {
                download: true,
                header: true,
                complete: (results) => resolve(results.data),
                error: (err) => reject(err),
            });
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
        const errorHtml = `<li class="gig-item">${ message }</li>`;
        this.querySelector("#upcoming-gigs").innerHTML = errorHtml;
        this.querySelector("#past-gigs").innerHTML = errorHtml;
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
        const nextContainer = this.querySelector("#next-container");

        if (nextGig)
        {
            nextContainer.style.display = "block";

            const titleEl = this.querySelector("#next-title");
            if (nextGig.link)
            {
                titleEl.innerHTML = `<a href="${ nextGig.link }" target="_blank" class="next-link">${ nextGig.title }</a>`;
            } else
            {
                titleEl.textContent = nextGig.title;
            }

            const dateObj = new Date(nextGig.date);
            const dateOptions = {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
            };
            
            // Check if time is provided in the string (not just midnight via timezone offset)
            const hasTime = nextGig.date.includes(':');
            if (hasTime) {
                dateOptions.hour = 'numeric';
                dateOptions.minute = '2-digit';
            }

            const dateStr = dateObj.toLocaleString(undefined, dateOptions);

            this.querySelector("#next-date").innerHTML = `<time datetime="${ nextGig.date }">${ dateStr }</time>`;
            this.querySelector("#next-location").textContent = nextGig.location;
            this.querySelector("#next-blurb").textContent = nextGig.blurb || "";
        } else
        {
            nextContainer.style.display = "none";
        }

        // 2. Render Upcoming List
        const upcomingList = this.querySelector("#upcoming-gigs");
        upcomingList.innerHTML = upcoming
            .slice(1)
            .map((gig) => this.createGigListItem(gig))
            .join("") || `<li class="gig-item">No more upcoming shows announced.</li>`;

        // 3. Render Past List
        const pastList = this.querySelector("#past-gigs");
        pastList.innerHTML = past
            .reverse()
            .map((gig) => this.createGigListItem(gig))
            .join("") || `<li class="gig-item">No past shows found.</li>`;

        this.dispatchEvent(new CustomEvent('gigs-loaded', {
            bubbles: true,
            composed: true
        }));
    }

    createGigListItem(gig)
    {
        let content = `<span><span class="gig-title">${ gig.title }</span> @ <span class="gig-location">${ gig.location }</span></span>`;

        if (gig.link)
        {
            content = `<span><a href="${ gig.link }" target="_blank" class="gig-link"><span class="gig-title">${ gig.title }</span></a> @ <span class="gig-location">${ gig.location }</span></span>`;
        }

        const blurbHtml = gig.blurb
            ? `<div class="gig-item-blurb">${ gig.blurb }</div>`
            : "";

        const dateObj = new Date(gig.date);
        const hasTime = gig.date.includes(':');
        const dateStr = hasTime 
            ? dateObj.toLocaleString(undefined, { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
            : dateObj.toLocaleDateString();

        const dateHtml = `<span class="gig-date"><time datetime="${ gig.date }">${ dateStr }</time></span>`;

        return `
      <li class="gig-item">
        <div class="gig-header-row">
            ${ content }
            ${ dateHtml }
        </div>
        ${ blurbHtml }
      </li>
    `;
    }
}

customElements.define("gig-info", GigInfo);
