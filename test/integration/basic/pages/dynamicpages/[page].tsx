import {GetServerSideProps, GetStaticPaths, GetStaticProps} from 'next';

interface Props {
	page: string;
}

export const getServerSideProps: GetServerSideProps<Props> = async (
	context,
) => {
	const page = context?.params?.page as string;

	return {
		props: {
			page,
		},
	};
};

export const verificationString = (page: string) => {
	return (
		'This is a dynamic page with getServerSideProps, at /dynamicpages/' + page
	);
};

const Page = ({page}: Props) => (
	<div>
		<h1>{verificationString(page)}</h1>
	</div>
);

export default Page;
