import Head from "next/head";
import { DesktopNavbar } from "../components/layout/DesktopNavbar";
import Footer from "../components/layout/Footer";

export default function DMCA() {
  return (
    <>
      <Head>
        <title>DMCA Policy - DocsDB</title>
        <meta name="description" content="DMCA Policy for DocsDB" />
      </Head>

      <div className="min-h-screen bg-dark-950 text-white flex flex-col">
        <DesktopNavbar />

        <main className="flex-grow pt-32 px-6 pb-16">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-4xl font-bold mb-8 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
              DMCA Policy
            </h1>

            <div className="space-y-8 text-dark-200 leading-relaxed">
              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  Digital Millennium Copyright Act Notice
                </h2>
                <p>
                  DocsDB respects the intellectual property rights of others. We
                  comply with the Digital Millennium Copyright Act (DMCA) and
                  other applicable copyright laws.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  Filing a DMCA Notice
                </h2>
                <p className="mb-4">
                  If you believe that your work has been copied in a way that
                  constitutes copyright infringement, please provide our
                  Copyright Agent with the following information in writing:
                </p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>
                    An electronic or physical signature of the person authorized
                    to act on behalf of the owner of the copyright interest;
                  </li>
                  <li>
                    A description of the copyrighted work that you claim has
                    been infringed;
                  </li>
                  <li>
                    A description of where the material that you claim is
                    infringing is located on the site (URL);
                  </li>
                  <li>Your address, telephone number, and email address;</li>
                  <li>
                    A statement by you that you have a good faith belief that
                    the disputed use is not authorized by the copyright owner,
                    its agent, or the law;
                  </li>
                  <li>
                    A statement by you, made under penalty of perjury, that the
                    above information in your notice is accurate and that you
                    are the copyright owner or authorized to act on the
                    copyright owner's behalf.
                  </li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  Counter-Notice
                </h2>
                <p className="mb-4">
                  If you believe that your content that was removed (or to which
                  access was disabled) is not infringing, or that you have the
                  authorization from the copyright owner, the copyright owner's
                  agent, or pursuant to the law, to post and use the material in
                  your content, you may send a counter-notice containing the
                  following information to the Copyright Agent:
                </p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>Your physical or electronic signature;</li>
                  <li>
                    Identification of the content that has been removed or to
                    which access has been disabled and the location at which the
                    content appeared before it was removed or disabled;
                  </li>
                  <li>
                    A statement that you have a good faith belief that the
                    content was removed or disabled as a result of mistake or a
                    misidentification of the content; and
                  </li>
                  <li>
                    Your name, address, telephone number, and email address, a
                    statement that you consent to the jurisdiction of the
                    federal court in your district, and a statement that you
                    will accept service of process from the person who provided
                    notification of the alleged infringement.
                  </li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  Contact Our Copyright Agent
                </h2>
                <p>
                  You can reach our Copyright Agent for Notice of claims of
                  copyright infringement at:
                </p>
                <div className="mt-4 p-6 bg-dark-900 rounded-lg border border-dark-800">
                  <p className="font-semibold text-white">
                    DocsDB Copyright Agent
                  </p>
                  <p>Email: copyright@docsdb.in</p>
                  <p>Phone: +91 9587096149</p>
                </div>
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
