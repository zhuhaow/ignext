import type {NextPage} from 'next';
import Head from 'next/head';
import Link from 'next/link';

const Home: NextPage = () => (
	<>
		<Head>
			<title>Create Next App</title>
			<meta name="description" content="Generated by create next app" />
		</Head>

		<main>
			<h2>This is /</h2>
			<Link href={{pathname: '/dynamicpages/test'}}>/dynamicpages/test</Link>
		</main>
	</>
);

export default Home;
