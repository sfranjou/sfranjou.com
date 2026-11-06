import { isCalendarDate, isZonedTimestamp } from "../dates.js";


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
            // Dynamically load PapaParse if it's not already on the window
            if (typeof Papa === "undefined")
            {
                await this.loadPapaParse();
            }

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
            .filter((gig) => gig.title && gig.date && (
                isCalendarDate(gig.date) || isZonedTimestamp(gig.date)
            ));

        this.renderConcerts(gigs);
    }

    renderConcerts(concerts)
    {
        const today = new Date();
        concerts.sort((a, b) => new Date(a.date) - new Date(b.date));

        const todayInBoston = today.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
        const isUpcoming = (concert) => isCalendarDate(concert.date)
            ? concert.date >= todayInBoston
            : new Date(concert.date) >= today;
        const upcoming = concerts.filter(isUpcoming);
        const past = concerts.filter(concert => !isUpcoming(concert));

        // 1. Render Next Gig
        const nextGig = upcoming[0];
        const nextContainer = this.querySelector("#next-container");

        if (nextGig)
        {
            nextContainer.style.display = "block";

            const titleEl = this.querySelector("#next-title");
            titleEl.replaceChildren(this.createTitle(nextGig, "next-link"));

            const dateObj = new Date(nextGig.date);
            const dateOptions = {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
                timeZone: isCalendarDate(nextGig.date) ? "UTC" : "America/New_York",
            };
            
            // Check if time is provided in the string (not just midnight via timezone offset)
            const hasTime = nextGig.date.includes(':');
            if (hasTime) {
                dateOptions.hour = 'numeric';
                dateOptions.minute = '2-digit';
            }

            const dateStr = dateObj.toLocaleString(undefined, dateOptions);

            const time = document.createElement("time");
            time.dateTime = nextGig.date;
            time.textContent = dateStr;
            this.querySelector("#next-date").replaceChildren(time);
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

    createTitle(gig, linkClass = "gig-link")
    {
        let url;
        try
        {
            const parsed = new URL(gig.link);
            if (["http:", "https:"].includes(parsed.protocol)) url = parsed.href;
        } catch { /* Missing or invalid links are shown as plain text. */ }

        const title = document.createElement(url ? "a" : "span");
        title.textContent = gig.title;
        title.className = url ? `gig-title ${ linkClass }` : "gig-title";
        if (url)
        {
            title.href = url;
            title.target = "_blank";
            title.rel = "noopener";
        }
        return title;
    }

    createGigListItem(gig)
    {
        const item = document.createElement("li");
        item.className = "gig-item";
        const row = document.createElement("div");
        row.className = "gig-header-row";
        const content = document.createElement("span");
        const location = document.createElement("span");
        location.className = "gig-location";
        location.textContent = gig.location;
        content.append(this.createTitle(gig), " @ ", location);

        const time = document.createElement("time");
        time.className = "gig-date";
        time.dateTime = gig.date;
        const dateObj = new Date(gig.date);
        time.textContent = isCalendarDate(gig.date)
            ? dateObj.toLocaleDateString(undefined, { timeZone: "UTC" })
            : dateObj.toLocaleString(undefined, {
                month: "numeric", day: "numeric", year: "numeric",
                hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
            });
        row.append(content, time);
        item.append(row);
        if (gig.blurb)
        {
            const blurb = document.createElement("div");
            blurb.className = "gig-item-blurb";
            blurb.textContent = gig.blurb;
            item.append(blurb);
        }
        return item.outerHTML;
    }
}

customElements.define("gig-info", GigInfo);
