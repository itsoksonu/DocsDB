import Head from "next/head";
import { DesktopNavbar } from "../components/layout/DesktopNavbar";
import Footer from "../components/layout/Footer";

export default function PrivacyPolicy() {
  return (
    <>
      <Head>
        <title>Privacy Policy - DocsDB</title>
        <meta name="description" content="Privacy Policy for DocsDB" />
      </Head>

      <div className="min-h-screen bg-dark-950 text-white flex flex-col">
        <DesktopNavbar />

        <main className="flex-grow pt-32 px-6 pb-16">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-4xl font-bold mb-8 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
              Privacy Policy
            </h1>

            <div className="space-y-8 text-dark-200 leading-relaxed">
              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  1. Introduction
                </h2>
                <p>
                  Welcome to DocsDB. We respect your privacy and are committed
                  to protecting your personal data. This privacy policy will
                  inform you as to how we look after your personal data when you
                  visit our website and tell you about your privacy rights and
                  how the law protects you.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  2. Data We Collect
                </h2>
                <p className="mb-4">
                  We may collect, use, store and transfer different kinds of
                  personal data about you which we have grouped together
                  follows:
                </p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>
                    <strong>Identity Data:</strong> includes first name, last
                    name, username or similar identifier.
                  </li>
                  <li>
                    <strong>Contact Data:</strong> includes email address.
                  </li>
                  <li>
                    <strong>Technical Data:</strong> includes internet protocol
                    (IP) address, your login data, browser type and version,
                    time zone setting and location, browser plug-in types and
                    versions, operating system and platform.
                  </li>
                  <li>
                    <strong>Usage Data:</strong> includes information about how
                    you use our website and services.
                  </li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  3. How We Use Your Data
                </h2>
                <p>
                  We will only use your personal data when the law allows us to.
                  Most commonly, we will use your personal data in the following
                  circumstances:
                </p>
                <ul className="list-disc pl-6 space-y-2 mt-4">
                  <li>
                    Where we need to perform the contract we are about to enter
                    into or have entered into with you.
                  </li>
                  <li>
                    Where it is necessary for our legitimate interests (or those
                    of a third party) and your interests and fundamental rights
                    do not override those interests.
                  </li>
                  <li>
                    Where we need to comply with a legal or regulatory
                    obligation.
                  </li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  4. Data Security
                </h2>
                <p>
                  We have put in place appropriate security measures to prevent
                  your personal data from being accidentally lost, used or
                  accessed in an unauthorized way, altered or disclosed. In
                  addition, we limit access to your personal data to those
                  employees, agents, contractors and other third parties who
                  have a business need to know.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  5. Contact Us
                </h2>
                <p>
                  If you have any questions about this privacy policy or our
                  privacy practices, please contact us at: support@docsdb.in
                </p>
              </section>

              <section>
                <p className="text-sm text-dark-400 mt-8">
                  Last Updated: {new Date().toLocaleDateString()}
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
