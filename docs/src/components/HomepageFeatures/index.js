import React from 'react'
import clsx from 'clsx'
import styles from './styles.module.css'

const FeatureList = [
    {
        title: 'E-Pharmacy',
        Svg: require('@site/static/img/undraw_docusaurus_mountain.svg').default,
        description: (
            <>
                Order medicines and health products online and get it delivered
                at home from licensed pharmacies
            </>
        ),
    },
    {
        title: 'Online Consultations',
        Svg: require('@site/static/img/undraw_docusaurus_tree.svg').default,
        description: (
            <>Consult qualified and registered doctors on chat for free</>
        ),
    },
    {
        title: 'Labs Tests',
        Svg: require('@site/static/img/undraw_docusaurus_react.svg').default,
        description: (
            <>
                Book lab tests online for hassle-free, home sample collection
                service.Get reports online.
            </>
        ),
    },
]

function Feature({ Svg, title, description }) {
    return (
        <div className={clsx('col col--4')}>
            <div className="text--center">
                <Svg className={styles.featureSvg} role="img" />
            </div>
            <div className="text--center padding-horiz--md">
                <h3>{title}</h3>
                <p>{description}</p>
            </div>
        </div>
    )
}

export default function HomepageFeatures() {
    return (
        <section className={styles.features}>
            <div className="container">
                <div className="row">
                    {FeatureList.map((props, idx) => (
                        <Feature key={idx} {...props} />
                    ))}
                </div>
            </div>
        </section>
    )
}
