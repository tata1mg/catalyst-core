import React from "react"
import { Link, useSearchParams } from "react-router"
import { useSelector } from "react-redux"
import { selectProducts } from "../../store/productsSlice"
import css from "./ProductList.scss"

function ProductList() {
    const products = useSelector(selectProducts)
    const [searchParams, setSearchParams] = useSearchParams()

    const category = searchParams.get("category") || ""
    const maxPriceParam = searchParams.get("maxPrice")
    const maxPrice = maxPriceParam ? Number(maxPriceParam) : 10000

    const handleCategoryChange = (e) => {
        const nextCategory = e.target.value
        const newParams = new URLSearchParams(searchParams)
        if (nextCategory && nextCategory !== "all") {
            newParams.set("category", nextCategory)
        } else {
            newParams.delete("category")
        }
        setSearchParams(newParams)
    }

    const handlePriceChange = (e) => {
        const nextPrice = e.target.value
        const newParams = new URLSearchParams(searchParams)
        newParams.set("maxPrice", nextPrice)
        setSearchParams(newParams)
    }

    const filteredProducts = (products || []).filter((product) => {
        const matchesCategory = !category || category === "all" || product.category === category
        const matchesPrice = product.price <= maxPrice
        return matchesCategory && matchesPrice
    })

    return (
        <div className={css.page}>
            <header className={css.header}>
                <h1 className={css.title}>Products</h1>
                <nav className={css.nav}>
                    <Link className={css.navLink} to="/">
                        Home
                    </Link>
                    <span>|</span>
                    <Link className={css.navLink} to="/cart">
                        Cart
                    </Link>
                </nav>
            </header>

            <section className={css.filters}>
                <div className={css.filterGroup}>
                    <label htmlFor="category-select" className={css.label}>
                        Category:
                    </label>
                    <select
                        id="category-select"
                        className={css.select}
                        value={category}
                        onChange={handleCategoryChange}
                    >
                        <option value="">All Categories</option>
                        <option value="footwear">Footwear</option>
                        <option value="electronics">Electronics</option>
                        <option value="apparel">Apparel</option>
                    </select>
                </div>

                <div className={css.filterGroup}>
                    <label htmlFor="price-range" className={css.label}>
                        Max Price:
                    </label>
                    <input
                        id="price-range"
                        type="range"
                        className={css.rangeInput}
                        min="500"
                        max="10000"
                        step="100"
                        value={maxPrice}
                        onChange={handlePriceChange}
                    />
                    <span className={css.priceValue}>₹{maxPrice}</span>
                </div>
            </section>

            <div className={css.grid}>
                {filteredProducts.length === 0 ? (
                    <p className={css.empty}>No products found matching the criteria.</p>
                ) : (
                    filteredProducts.map((product) => (
                        <Link
                            key={product.id}
                            to={`/product/${product.id}`}
                            className={css.card}
                        >
                            <div>
                                <div className={css.cardHeader}>
                                    <h2 className={css.productName}>{product.name}</h2>
                                    <span className={css.categoryTag}>{product.category}</span>
                                </div>
                                <p className={css.productDesc}>{product.description}</p>
                            </div>
                            <div className={css.cardFooter}>
                                <span className={css.price}>₹{product.price}</span>
                                <span className={css.viewBtn}>View Details &rarr;</span>
                            </div>
                        </Link>
                    ))
                )}
            </div>
        </div>
    )
}

/**
 * Declarative WebMCP read tool. WebMcpProvider derives:
 *   name         "products"           (from the route path /products)
 *   inputSchema  the searchParams below, all optional
 *   execute      navigate("/products?category=…&maxPrice=…"), then report
 * The page itself already reads these same params via useSearchParams and
 * filters the list — so the agent's call and a human tweaking the controls
 * land on the exact same URL state.
 */
// Ordinary SEO metadata — Catalyst renders this into <head> via MetaTag, and
// the WebMCP `get_page_info` tool reads the same static. One source, two uses.
ProductList.setMetaData = () => [
    <title key="t">Shop all products — WebMCP POC</title>,
    <meta
        key="d"
        name="description"
        content="Browse the full catalogue of footwear, electronics and apparel. Filter by category and price."
    />,
    <meta key="og" property="og:title" content="Product catalogue" />,
]

ProductList.tool = {
    description:
        "Browse the product catalogue. Optionally filter by category and/or a maximum price (INR). " +
        "Returns by navigating to the filtered listing.",
    searchParams: {
        category: {
            type: "string",
            enum: ["footwear", "electronics", "apparel"],
            description: "restrict to one product category",
        },
        maxPrice: {
            type: "number",
            description: "only show products at or below this price, in INR (e.g. 3000)",
        },
    },
    annotations: { readOnlyHint: true },
}

export default ProductList
