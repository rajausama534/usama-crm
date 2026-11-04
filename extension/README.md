# Usama CRM Unit Finder Chrome Extension

## Install

1. Download or clone this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the `extension` folder.

## Use

1. Open a listing on Bayut, Dubizzle, or Property Finder.
2. Click the **Usama CRM Unit Finder** extension.
3. Click **Extract Current Listing**.
4. Review the extracted details.
5. Click **Open in CRM**.
6. If a confirmed unit mapping already exists, it appears automatically.
7. Otherwise, enter the confirmed unit/property/land number once and click **Save Mapping**.

The extension reads the listing page already open in your browser, which avoids normal server-side CORS and anti-bot blocks. It does not bypass portal login controls and only reads content available in the currently opened page.

## DXBinteract sales → CRM

1. Reload the extension in `chrome://extensions` after updating (click the circular arrow on its card).
2. On dxbinteract.com open a project's **Sales** list (e.g. Farm Gardens). Scroll to load all the rows you want.
3. Click **Send sales to Usama CRM** (bottom right).
4. The CRM opens with a preview: sales that match an exact unit in the same cluster, ones already stored, and
   ones skipped. Click **Import** to add them to each unit's transaction history. Nothing existing is changed,
   and sending the same page again never creates duplicates.

Only the rows already visible on the page are read, only when you click, using your own browser session.

## Update a whole cluster from DXB Interact (one click)

1. Install or reload the extension (steps above, or the ↻ arrow on its card in `chrome://extensions`).
2. Log in to dxbinteract.com in the same Chrome.
3. In the CRM open **Cluster Data**, pick the community and the cluster, and press **Update from DXB Interact**.
4. A DXB Interact tab opens and works by itself: it searches the cluster, sets the dates to all years (2012 → today),
   reads every page of sales and sends them back to the CRM tab, then closes. Keep the CRM tab open meanwhile.
5. The CRM saves new sales (never twice), then fills each unit's bedrooms / BUA / plot only where empty, updates the
   sale line in the owner notes (other note text stays) and marks New / Contacted owners as Sold after a resale in the
   last 12 months. A short summary is shown at the end.

If the CRM says the extension did not answer, it is not installed or not reloaded yet.
Lists on DXB Interact stop at 300 rows, so bigger clusters are read newest-first and oldest-first, and very big
ones one year at a time.
