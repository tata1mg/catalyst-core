// src/js/pages/About/About.js
import React from "react"

const About = () => {
    return (
        <div className="container">
            <h1>About Our Dog Adoption Center</h1>
            <p>We are dedicated to finding loving homes for all dogs in need.</p>
            <p>Our mission is to connect dog lovers with animals looking for a forever home.</p>
            <p>
                This is a demo application built with Catalyst to showcase server-side rendering capabilities.
            </p>
            <p>
                It uses the <a href="https://dog.ceo/dog-api/">Dog API</a> to display information about
                different dog breeds.
            </p>
        </div>
    )
}

About.setMetaData = () => {
    return [<title key="title">About</title>]
}

export default About
