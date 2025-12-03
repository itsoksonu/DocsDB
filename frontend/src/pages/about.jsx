import Head from "next/head";
import { DesktopNavbar } from "../components/layout/DesktopNavbar";
import Footer from "../components/layout/Footer";

export default function About() {
  return (
    <>
      <Head>
        <title>About Us - DocsDB</title>
        <meta
          name="description"
          content="About DocsDB - The premier platform for discovering and sharing knowledge."
        />
      </Head>

      <div className="min-h-screen bg-dark-950 text-white flex flex-col">
        <DesktopNavbar />

        <main className="flex-grow pt-32 px-6 pb-16">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-4xl font-bold mb-8 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
              About DocsDB
            </h1>

            <div className="space-y-12 text-dark-200 leading-relaxed">
              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  Our Mission
                </h2>
                <p className="text-lg">
                  At DocsDB, our mission is to democratize access to knowledge.
                  We believe that information should be easily accessible,
                  organized, and shareable. Whether you're a student,
                  researcher, or professional, DocsDB provides the tools you
                  need to find and share valuable documents.
                </p>
              </section>

              <section className="grid md:grid-cols-2 gap-8">
                <div className="bg-dark-900 p-6 rounded-xl border border-dark-800">
                  <h3 className="text-xl font-semibold text-white mb-3">
                    For Readers
                  </h3>
                  <p>
                    Discover millions of documents across various categories.
                    From academic papers to technical manuals, find exactly what
                    you need with our advanced search and recommendation engine.
                  </p>
                </div>
                <div className="bg-dark-900 p-6 rounded-xl border border-dark-800">
                  <h3 className="text-xl font-semibold text-white mb-3">
                    For Creators
                  </h3>
                  <p>
                    Share your knowledge with a global audience. Upload your
                    documents, track their impact, and build your reputation as
                    a thought leader in your field.
                  </p>
                </div>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  Our Story
                </h2>
                <p>
                  DocsDB started with a simple idea: make document sharing
                  better. We noticed that valuable knowledge was often trapped
                  in inaccessible silos or lost in the noise of the internet. We
                  built DocsDB to be the central hub where knowledge seekers and
                  sharers connect.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  Join Our Community
                </h2>
                <p>
                  We are more than just a platform; we are a community of
                  learners and educators. Join us in our journey to make the
                  world's knowledge more accessible.
                </p>
              </section>
            </div>
          </div>
        </main>

        <Footer />
      </div>
    </>
  );
}
