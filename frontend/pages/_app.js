
import { useRouter } from 'next/router';
import '../styles/globals.css';

export default function App({ Component, pageProps }) {
    const router = useRouter();

    // Using router.asPath ensures the page fully remounts on every navigation,
    // including navigating back to a page already in history.
    return <Component key={router.asPath} {...pageProps} />;
}