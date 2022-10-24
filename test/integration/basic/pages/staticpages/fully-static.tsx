import {GetStaticProps} from 'next';

interface Props {
	page: string;
}

export const getStaticProps: GetStaticProps<Props> = async () => {
	const page = 'SSG Fully Static';

	return {
		props: {
			page,
		},
	};
};

export const verificationString = () => {
	return 'This is a page with getStaticProps, at /staticpages/fully-static';
};

const Page = ({page}: Props) => (
	<div>
		<h1>{verificationString()}</h1>
	</div>
);

export default Page;
