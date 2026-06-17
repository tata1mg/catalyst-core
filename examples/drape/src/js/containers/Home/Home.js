import React from "react"
import css from "./Home.scss"

function Home() {
    return (
        <div className={css.app}>
            <header className={css.appHeader}>
                <h1 className={css.heading}>Catalyst</h1>
                <p>Edit files inside src directory and save to reload.</p>
                <a
                    className={css.appLink}
                    href="https://catalyst.1mg.com"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Learn Catalyst
                </a>
            </header>
        </div>
    )
}

export default Home
