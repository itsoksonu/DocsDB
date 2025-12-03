import Head from "next/head";
import { DesktopNavbar } from "../components/layout/DesktopNavbar";
import Footer from "../components/layout/Footer";
import Link from "next/link";

export default function Copyright() {
  return (
    <>
      <Head>
        <title>Copyright Policy - DocsDB</title>
        <meta name="description" content="Copyright Policy for DocsDB" />
      </Head>

      <div className="min-h-screen bg-dark-950 text-white flex flex-col">
        <DesktopNavbar />

        <main className="flex-grow pt-32 px-6 pb-16">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-4xl font-bold mb-8 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
              Copyright Policy
            </h1>

            <div className="space-y-8 text-dark-200 leading-relaxed">
              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  Intellectual Property Rights
                </h2>
                <p>
                  DocsDB respects the intellectual property rights of others and
                  expects its users to do the same. It is our policy, in
                  appropriate circumstances and at our discretion, to disable
                  and/or terminate the accounts of users who repeatedly infringe
                  or are repeatedly charged with infringing the copyrights or
                  other intellectual property rights of others.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  Content Ownership
                </h2>
                <p className="mb-4">
                  All content hosted on DocsDB is uploaded by our community of
                  users. DocsDB does not claim ownership of the documents
                  uploaded by users. However, by uploading content, users
                  warrant that they have the right to distribute such content
                  and grant DocsDB a license to display and distribute it on the
                  platform.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  Reporting Copyright Infringement
                </h2>
                <p>
                  If you are a copyright owner, or are authorized to act on
                  behalf of one, or authorized to act under any exclusive right
                  under copyright, please report alleged copyright infringements
                  taking place on or through the Site by completing the
                  following DMCA Notice of Alleged Infringement and delivering
                  it to our Designated Copyright Agent.
                </p>
                <p className="mt-4">
                  For more details on how to submit a notice, please visit our{" "}
                  <Link
                    href="/dmca"
                    className="text-blue-400 hover:text-blue-300 underline"
                  >
                    DMCA Policy page
                  </Link>
                  .
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  Trademarks
                </h2>
                <p>
                  "DocsDB", the DocsDB logo, and any other product or service
                  name or slogan contained in the Site are trademarks of DocsDB
                  and its suppliers or licensors, and may not be copied,
                  imitated or used, in whole or in part, without the prior
                  written permission of DocsDB or the applicable trademark
                  holder.
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
